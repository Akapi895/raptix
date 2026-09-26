package api

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
	"sync"

	"github.com/google/uuid"
)

type Event struct {
	ID, Type string
	Data     any
}
type eventStream struct {
	next        uint64
	events      []Event
	subscribers map[chan Event]struct{}
}

// Hub retains a bounded process-local replay window per run. Events are advisory;
// callers must use Snapshot when a cursor cannot be replayed.
type Hub struct {
	mu       sync.Mutex
	epoch    string
	capacity int
	streams  map[uuid.UUID]*eventStream
}

func NewHub(capacity int) *Hub {
	if capacity < 1 {
		capacity = 128
	}
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return &Hub{epoch: base64.RawURLEncoding.EncodeToString(b), capacity: capacity, streams: map[uuid.UUID]*eventStream{}}
}
func (h *Hub) Publish(runID uuid.UUID, typ string, data any) {
	h.mu.Lock()
	defer h.mu.Unlock()
	s := h.stream(runID)
	s.next++
	e := Event{ID: fmt.Sprintf("%s:%d", h.epoch, s.next), Type: typ, Data: data}
	s.events = append(s.events, e)
	if len(s.events) > h.capacity {
		s.events = s.events[len(s.events)-h.capacity:]
	}
	for ch := range s.subscribers {
		select {
		case ch <- e:
		default:
			close(ch)
			delete(s.subscribers, ch)
		}
	}
}
func (h *Hub) Subscribe(runID uuid.UUID, cursor string) ([]Event, bool, <-chan Event, func(), error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	s := h.stream(runID)
	sequence, sameEpoch, err := h.parseCursor(cursor)
	if err != nil {
		return nil, false, nil, nil, err
	}
	gap := cursor == "" || !sameEpoch
	var replay []Event
	if !gap {
		if sequence > s.next || (len(s.events) > 0 && sequence+1 < eventSequence(s.events[0].ID)) {
			gap = true
		} else {
			for _, e := range s.events {
				if eventSequence(e.ID) > sequence {
					replay = append(replay, e)
				}
			}
		}
	}
	ch := make(chan Event, 16)
	s.subscribers[ch] = struct{}{}
	return replay, gap, ch, func() {
		h.mu.Lock()
		if _, ok := s.subscribers[ch]; ok {
			delete(s.subscribers, ch)
			close(ch)
		}
		h.mu.Unlock()
	}, nil
}
func (h *Hub) stream(runID uuid.UUID) *eventStream {
	s := h.streams[runID]
	if s == nil {
		s = &eventStream{subscribers: map[chan Event]struct{}{}}
		h.streams[runID] = s
	}
	return s
}
func (h *Hub) parseCursor(cursor string) (uint64, bool, error) {
	if cursor == "" {
		return 0, true, nil
	}
	p := strings.Split(cursor, ":")
	if len(p) != 2 || !validEpoch(p[0]) {
		return 0, false, BadRequest("event cursor is invalid")
	}
	n, err := strconv.ParseUint(p[1], 10, 64)
	if err != nil || n == 0 {
		return 0, false, BadRequest("event cursor is invalid")
	}
	return n, p[0] == h.epoch, nil
}

func validEpoch(epoch string) bool {
	if len(epoch) == 0 || len(epoch) > 64 {
		return false
	}
	for _, c := range epoch {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '-') {
			return false
		}
	}
	return true
}
func eventSequence(id string) uint64 {
	_, n, _ := strings.Cut(id, ":")
	v, _ := strconv.ParseUint(n, 10, 64)
	return v
}
