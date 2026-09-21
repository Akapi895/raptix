package output

import (
	"encoding/json"
	"errors"
	"testing"
)

func TestSuccessAndPartialContracts(t *testing.T) {
	success := Success("raw/1", "structured/1", "nmap.v1")
	if !success.OK() || success.Execution != ExecutionSuccess || success.Parse != ParseSuccess {
		t.Fatalf("unexpected success: %+v", success)
	}
	if err := success.Validate(); err != nil {
		t.Fatal(err)
	}
	partial := Partial("raw/2", "structured/2", "nmap.v1", []Diagnostic{{Level: "warning", Message: "incomplete"}})
	if !partial.OK() || partial.Parse != ParsePartial {
		t.Fatalf("unexpected partial: %+v", partial)
	}
	if err := partial.Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestParseFailurePreservesRawEvidence(t *testing.T) {
	r := ParseFailure("raw/3", "nmap.v1", errors.New("invalid header"))
	if r.Execution != ExecutionSuccess || r.Parse != ParseFailed || r.RawRef == "" || r.Error == nil {
		t.Fatalf("unexpected parse failure: %+v", r)
	}
	if err := r.Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestFailureJSONRoundTripAndInvalidCombinations(t *testing.T) {
	r := Timeout("raw/4", errors.New("deadline exceeded"))
	b, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	var got Result
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}
	if got.Error == nil || got.Error.Message != "deadline exceeded" {
		t.Fatalf("lost serialized error: %s", b)
	}
	if err := got.Validate(); err != nil {
		t.Fatal(err)
	}
	if err := (&Result{Execution: ExecutionSuccess, Parse: ParseSuccess}).Validate(); err == nil {
		t.Error("expected missing structured ref validation error")
	}
	if err := (&Result{Execution: ExecutionFailed, Parse: ParseSuccess, StructuredRef: "x", RawRef: "raw", ParserVersion: "v1"}).Validate(); err == nil {
		t.Error("expected contradictory status validation error")
	}
}
