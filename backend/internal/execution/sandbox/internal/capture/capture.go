// Package capture holds the stream-capture helper shared by the concrete
// sandbox runners. It lives under execution/sandbox/internal so only the runner
// implementations can use it, never tools or business packages.
package capture

import "bytes"

// DefaultMaxOutput caps a single stdout/stderr stream when no spec cap is set.
const DefaultMaxOutput = 1 << 20 // 1 MiB

// Buffer collects writes up to a byte cap, preserving the first max bytes and
// remembering whether output was truncated. It never fails a write: the child
// process must not receive SIGPIPE just because its output was capped.
type Buffer struct {
	buf       bytes.Buffer
	max       int64
	truncated bool
}

// NewBuffer builds a capped buffer.
func NewBuffer(max int64) *Buffer {
	if max <= 0 {
		max = DefaultMaxOutput
	}
	return &Buffer{max: max}
}

func (c *Buffer) Write(p []byte) (int, error) {
	remaining := c.max - int64(c.buf.Len())
	if remaining <= 0 {
		c.truncated = true
		return len(p), nil
	}
	if int64(len(p)) > remaining {
		_, _ = c.buf.Write(p[:remaining])
		c.truncated = true
		return len(p), nil
	}
	_, _ = c.buf.Write(p)
	return len(p), nil
}

// Bytes returns the captured prefix.
func (c *Buffer) Bytes() []byte { return c.buf.Bytes() }

// Truncated reports whether any write was dropped.
func (c *Buffer) Truncated() bool { return c.truncated }
