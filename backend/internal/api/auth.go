package api

import (
	"context"
	"fmt"
	"strings"

	"github.com/coreos/go-oidc/v3/oidc"
)

type Authenticator interface {
	Authenticate(context.Context, string) (Principal, error)
}

type AuthConfig struct{ Mode, Issuer, Audience, DevelopmentPrincipal string }

func NewAuthenticator(ctx context.Context, cfg AuthConfig) (Authenticator, error) {
	switch cfg.Mode {
	case "development":
		if strings.TrimSpace(cfg.DevelopmentPrincipal) == "" {
			return nil, fmt.Errorf("auth.development_principal is required in development mode")
		}
		return fixedAuthenticator{subject: cfg.DevelopmentPrincipal}, nil
	case "oidc":
		if cfg.Issuer == "" || cfg.Audience == "" {
			return nil, fmt.Errorf("auth.issuer and auth.audience are required in oidc mode")
		}
		provider, err := oidc.NewProvider(ctx, cfg.Issuer)
		if err != nil {
			return nil, fmt.Errorf("discover OIDC provider: %w", err)
		}
		return oidcAuthenticator{verifier: provider.Verifier(&oidc.Config{ClientID: cfg.Audience})}, nil
	default:
		return nil, fmt.Errorf("auth.mode %q is invalid (development|oidc)", cfg.Mode)
	}
}

type fixedAuthenticator struct{ subject string }

func (a fixedAuthenticator) Authenticate(_ context.Context, _ string) (Principal, error) {
	return Principal{Subject: a.subject}, nil
}

type oidcAuthenticator struct{ verifier *oidc.IDTokenVerifier }

func (a oidcAuthenticator) Authenticate(ctx context.Context, authorization string) (Principal, error) {
	parts := strings.Fields(authorization)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return Principal{}, Unauthorized("a Bearer token is required")
	}
	token, err := a.verifier.Verify(ctx, parts[1]) // verifies issuer, audience, signature, and expiry.
	if err != nil || strings.TrimSpace(token.Subject) == "" {
		return Principal{}, Unauthorized("the bearer token is invalid")
	}
	return Principal{Subject: token.Subject}, nil
}
