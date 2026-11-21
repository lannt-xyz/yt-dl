import asyncio
import threading

from app.events import EventBroker


async def test_publish_reaches_all_subscribers():
    broker = EventBroker()
    broker.bind_loop(asyncio.get_running_loop())
    q1, q2 = broker.open_queue(), broker.open_queue()
    broker.publish({"type": "job", "n": 1})
    assert (await asyncio.wait_for(q1.get(), 1))["n"] == 1
    assert (await asyncio.wait_for(q2.get(), 1))["n"] == 1
    broker.close_queue(q1)
    broker.close_queue(q2)
    assert broker.subscriber_count == 0


async def test_publish_from_other_thread():
    broker = EventBroker()
    broker.bind_loop(asyncio.get_running_loop())
    queue = broker.open_queue()
    threading.Thread(target=broker.publish, args=({"type": "job", "n": 7},)).start()
    assert (await asyncio.wait_for(queue.get(), 1))["n"] == 7


async def test_slow_subscriber_drops_oldest():
    broker = EventBroker(queue_size=2)
    broker.bind_loop(asyncio.get_running_loop())
    queue = broker.open_queue()
    for n in range(4):
        broker.publish({"type": "job", "n": n})
    got = [queue.get_nowait()["n"] for _ in range(queue.qsize())]
    assert got == [2, 3]


async def test_subscribe_cleans_up_on_close():
    broker = EventBroker()
    broker.bind_loop(asyncio.get_running_loop())
    agen = broker.subscribe()
    task = asyncio.create_task(agen.__anext__())
    await asyncio.sleep(0.01)
    assert broker.subscriber_count == 1
    broker.publish({"type": "x"})
    assert (await task)["type"] == "x"
    await agen.aclose()
    assert broker.subscriber_count == 0


def test_publish_without_loop_is_noop():
    EventBroker().publish({"type": "x"})


async def test_sse_endpoint_streams_hello_events_and_heartbeat(monkeypatch):
    from app.api import system
    from app.db import Database
    from app.repository import JobRepo

    class FakeRequest:
        disconnected = False

        async def is_disconnected(self):
            return self.disconnected

    monkeypatch.setattr(system, "HEARTBEAT_SECONDS", 0.05)
    db = Database(":memory:")
    broker = EventBroker()
    broker.bind_loop(asyncio.get_running_loop())
    request = FakeRequest()

    response = await system.events(request, JobRepo(db), broker)
    assert response.media_type == "text/event-stream"
    stream = response.body_iterator

    assert (await stream.__anext__()).startswith("event: hello\n")
    assert broker.subscriber_count == 1

    assert (await stream.__anext__()) == ": ping\n\n"  # không có sự kiện → heartbeat

    broker.publish({"type": "job", "job": {"id": "abc", "title": "Tiếng Việt"}})
    chunk = await stream.__anext__()
    assert chunk.startswith("event: job\n") and "Tiếng Việt" in chunk and chunk.endswith("\n\n")

    request.disconnected = True
    await stream.aclose()
    assert broker.subscriber_count == 0
    db.close()
