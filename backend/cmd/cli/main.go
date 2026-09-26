// Command cli is the raptix terminal client. It only communicates with cmd/server.
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/Akapi895/raptix/backend/internal/cli"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	command := cli.NewRootCmd(os.Stdout, os.Stderr)
	command.SetArgs(os.Args[1:])
	command.SetContext(ctx)
	if err := command.Execute(); err != nil {
		fmt.Fprintf(os.Stderr, "raptix: %v\n", err)
		os.Exit(cli.ExitCode(err))
	}
}
