import pytest

from app.db import Database
from app.repository import JobRepo


@pytest.fixture
def repo():
    db = Database(":memory:")
    yield JobRepo(db)
    db.close()


def make(repo, title="t", status="queued", **kw):
    job = repo.create(url="https://www.youtube.com/watch?v=aaaaaaaaaaa", video_id="aaaaaaaaaaa",
                      title=title, **kw)  # fmt: skip
    if status != "queued":
        job = repo.update(job["id"], status=status)
    return job


def test_create_and_get(repo):
    job = make(repo)
    assert job["status"] == "queued" and job["progress"] == 0 and job["kind"] == "download"
    assert repo.get(job["id"])["id"] == job["id"]
    assert repo.get("missing") is None


def test_update_rejects_unknown_column(repo):
    job = make(repo)
    with pytest.raises(ValueError):
        repo.update(job["id"], **{"title = 'x'; --": 1})
    with pytest.raises(ValueError):
        repo.create(bogus=1, url="u")


def test_claim_next_is_fifo_and_only_download(repo):
    first = make(repo, "first")
    make(repo, "second")
    repo.create(kind="trim", url="u", status="queued")
    claimed = repo.claim_next()
    assert claimed["id"] == first["id"] and claimed["status"] == "fetching_info"
    assert claimed["started_at"] is not None
    assert repo.claim_next()["title"] == "second"
    assert repo.claim_next() is None


def test_reset_running_to_queued(repo):
    a = make(repo, status="downloading")
    b = make(repo, status="converting")
    c = make(repo, status="done")
    assert repo.reset_running_to_queued() == 2
    assert repo.get(a["id"])["status"] == "queued"
    assert repo.get(b["id"])["status"] == "queued"
    assert repo.get(c["id"])["status"] == "done"


def test_list_filters_search_and_paging(repo):
    for i in range(5):
        make(repo, f"Song {i}", status="done")
    make(repo, "Podcast", status="failed")
    make(repo, "Waiting")
    items, total = repo.list(limit=3)
    assert total == 7 and len(items) == 3
    assert repo.list(status="done")[1] == 5
    assert repo.list(status="active")[1] == 1
    assert repo.list(q="podc")[1] == 1
    page2, _ = repo.list(limit=3, offset=3)
    assert {j["id"] for j in items}.isdisjoint({j["id"] for j in page2})


def test_list_newest_first(repo):
    a = make(repo, "a")
    b = make(repo, "b")
    items, _ = repo.list()
    assert [j["id"] for j in items] == [b["id"], a["id"]]


def test_seen_counters(repo):
    make(repo, status="done")
    make(repo, status="failed")
    make(repo, status="downloading")
    assert repo.unseen_count() == 2
    assert repo.mark_all_seen() == 2
    assert repo.unseen_count() == 0


def test_delete_orphans_children(repo):
    parent = make(repo, status="done")
    child = repo.create(kind="trim", url="u", parent_id=parent["id"], status="done")
    repo.delete(parent["id"])
    assert repo.get(parent["id"]) is None
    assert repo.get(child["id"])["parent_id"] is None


def test_find_by_video(repo):
    job = make(repo, status="done")
    assert repo.find_by_video("aaaaaaaaaaa", ("done",))["id"] == job["id"]
    assert repo.find_by_video("aaaaaaaaaaa", ("queued",)) is None
    assert repo.find_by_video("zzzzzzzzzzz", ("done",)) is None
