package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/local/mxd-auto-process/internal/autostore"
	"github.com/local/mxd-auto-process/internal/gameprotocol"
	"github.com/local/mxd-auto-process/internal/gamesession"
	"github.com/local/mxd-auto-process/internal/operatorapi"
	"github.com/local/mxd-auto-process/internal/servercatalog"
	"github.com/local/mxd-auto-process/internal/sessioncontrol"
)

func main() {
	configPath := flag.String("config", "config/servers.json", "server catalog path")
	listenAddress := flag.String("listen", "127.0.0.1:26909", "HTTP listen address")
	maxSessions := flag.Int("max-sessions", 128, "maximum concurrent sessions")
	roleOpaquePCAPPath := flag.String("role-opaque-pcap-path", "", "PCAP file or directory used to resolve role selection values (defaults to ../datacj beside the config directory)")
	databasePath := flag.String("database", envOrDefault("AUTO_DATABASE_PATH", "data/auto.sqlite"), "auto SQLite database path")
	keyPath := flag.String("credential-key", envOrDefault("AUTO_CREDENTIAL_KEY_PATH", "data/auto-credentials.key"), "account credential encryption key path")
	initialPassword := flag.String("initial-password", envOrDefault("AUTO_INITIAL_PASSWORD", "ChangeMe-26909!"), "initial operator password; it must be changed after first login")
	serviceToken := flag.String("service-token", envOrDefault("AUTO_SERVICE_TOKEN", "local-auto-service-token"), "service token for the operations desk")
	flag.Parse()
	roleOpaquePath := *roleOpaquePCAPPath
	if roleOpaquePath == "" {
		roleOpaquePath = defaultRoleOpaquePCAPPath(*configPath)
	}

	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	store, err := autostore.Open(*databasePath, *keyPath, *initialPassword)
	if err != nil {
		logger.Error("open auto database", "error", err)
		os.Exit(1)
	}
	defer store.Close()
	catalog, err := servercatalog.LoadWithPersistence(*configPath, store)
	if err != nil {
		logger.Error("load server catalog", "error", err)
		os.Exit(1)
	}
	resolver := gamesession.NewPCAPRoleOpaqueResolver(roleOpaquePath)
	manager, err := sessioncontrol.NewWithRoleOpaqueResolver(catalog, gameprotocol.TCPDialer{}, *maxSessions, resolver)
	if err != nil {
		logger.Error("create session manager", "error", err)
		os.Exit(1)
	}
	defer manager.Close()
	accounts, err := sessioncontrol.NewAccountManager(manager, store)
	if err != nil {
		logger.Error("create account manager", "error", err)
		os.Exit(1)
	}
	defer accounts.Close()
	handler, err := operatorapi.NewHandler(manager, catalog, operatorapi.Options{Store: store, Accounts: accounts, ServiceToken: *serviceToken, SecureCookie: os.Getenv("AUTO_COOKIE_SECURE") == "true"})
	if err != nil {
		logger.Error("create operator api", "error", err)
		os.Exit(1)
	}
	accounts.StartEnabled(nil)

	server := &http.Server{
		Addr:              *listenAddress,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	shutdownContext, stopSignal := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stopSignal()
	go func() {
		<-shutdownContext.Done()
		closeContext, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(closeContext)
	}()

	logger.Info("operator api listening", "address", *listenAddress, "servers", len(catalog.List()), "max_sessions", *maxSessions)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Error("serve operator api", "error", err)
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func defaultRoleOpaquePCAPPath(configPath string) string {
	configDir := filepath.Dir(configPath)
	if configDir == "." || configDir == "" {
		return "datacj"
	}
	return filepath.Join(configDir, "..", "datacj")
}

func envOrDefault(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
