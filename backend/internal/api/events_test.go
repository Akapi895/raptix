package api

import (
	"fmt"
	"github.com/google/uuid"
	"testing"
)

func TestHubReplaysContiguousEventsAndFallsBackOnGap(t *testing.T) {
	h := NewHub(2)
	run := uuid.New()
	h.Publish(run, "one", 1)
	h.Publish(run, "two", 2)
	_, _, ch, stop, err := h.Subscribe(run, "")
	if err != nil {
		t.Fatal(err)
	}
	_ = ch
	stop()
	h.Publish(run, "three", 3)
	h.Publish(run, "four", 4)
	replay, gap, ch, stop, err := h.Subscribe(run, "invalid")
	if err == nil || replay != nil || gap || ch != nil || stop != nil {
		t.Fatal("invalid cursor was accepted")
	}
	if _, _, _, _, err := h.Subscribe(run, "bad!:1"); err == nil {
		t.Fatal("cursor with invalid epoch was accepted")
	}
	// The first event was evicted, so a cursor before it needs a snapshot.
	replay, gap, ch, stop, err = h.Subscribe(run, "other:1")
	if err != nil || !gap || len(replay) != 0 {
		t.Fatalf("gap=%v replay=%v err=%v", gap, replay, err)
	}
	_ = ch
	stop()
	// A cursor at the retained predecessor replays the contiguous tail.
	replay, gap, ch, stop, err = h.Subscribe(run, eventID(h, 2))
	if err != nil || gap || len(replay) != 2 {
		t.Fatalf("replay subscribe: gap=%v replay=%v err=%v", gap, replay, err)
	}
	_ = ch
	stop()
}

func TestHubDisconnectsSlowSubscriberWithoutBlockingPublishers(t *testing.T) {
	h := NewHub(1)
	run := uuid.New()
	_, _, slow, stop, err := h.Subscribe(run, "")
	if err != nil {
		t.Fatal(err)
	}
	defer stop()
	for i := 0; i < 17; i++ {
		h.Publish(run, "updated", i)
	}
	for i := 0; i < 16; i++ {
		if _, open := <-slow; !open {
			t.Fatal("slow subscriber closed before its buffered events were drained")
		}
	}
	if _, open := <-slow; open {
		t.Fatal("slow subscriber remained connected after its buffer filled")
	}
}

func eventID(h *Hub, sequence uint64) string {
	h.mu.Lock()
	defer h.mu.Unlock()
	return fmt.Sprintf("%s:%d", h.epoch, sequence)
}
