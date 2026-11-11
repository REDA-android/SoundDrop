package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"sound-drop-daemon/internal/ipc"
	"sound-drop-daemon/internal/session"
)

func main() {
	log.Println("[SoundDrop Daemon] Starting native acoustic controller daemon v2.0.0...")

	sessionMgr := session.NewSessionManager()

	// Initialize IPC loopback bridge on port 9444
	bridge, err := ipc.NewIPCBridge(9444)
	if err != nil {
		log.Fatalf("[SoundDrop Daemon] IPC Initialization failed: %v", err)
	}
	bridge.Start()
	log.Println("[SoundDrop Daemon] IPC Bridge listening on 127.0.0.1:9444")

	// Worker Goroutine: Periodic peer health check & telemetry broadcasting
	go func() {
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()

		for range ticker.C {
			peers := sessionMgr.GetPeers()
			state := sessionMgr.GetState()

			telemetryPayload := map[string]any{
				"device_state": state,
				"peer_count":   len(peers),
				"peers":        peers,
				"timestamp":    time.Now().UnixMilli(),
			}

			_ = bridge.Broadcast("TELEMETRY", telemetryPayload)
		}
	}()

	// Worker Goroutine: Process inbound commands from desktop UI or DSP FFI
	go func() {
		for msg := range bridge.Inbound() {
			switch msg.Type {
			case "COMMAND_START_EMIT":
				sessionMgr.SetState(session.StateEmittingPing)
				log.Println("[SoundDrop Daemon] State -> EMITTING_PING")
				_ = bridge.Broadcast("STATUS_CHANGED", map[string]string{"state": string(session.StateEmittingPing)})

			case "COMMAND_STOP_EMIT":
				sessionMgr.SetState(session.StateIdle)
				log.Println("[SoundDrop Daemon] State -> IDLE")
				_ = bridge.Broadcast("STATUS_CHANGED", map[string]string{"state": string(session.StateIdle)})

			case "EVENT_CHIRP_LOCKED":
				sessionMgr.SetState(session.StateLockedOnSignal)
				log.Println("[SoundDrop Daemon] Acoustic LFM Chirp Locked! State -> LOCKED")
				_ = bridge.Broadcast("STATUS_CHANGED", map[string]string{"state": string(session.StateLockedOnSignal)})

			case "EVENT_PEER_PING":
				var data struct {
					ID         string  `json:"id"`
					DeviceType string  `json:"device_type"`
					Name       string  `json:"name"`
					Color      string  `json:"color"`
					SnrDb      float64 `json:"snr_db"`
				}
				if err := json.Unmarshal(msg.Payload, &data); == nil {
					peer := sessionMgr.RegisterPeer(data.ID, data.DeviceType, data.Name, data.Color, data.SnrDb)
					log.Printf("[SoundDrop Daemon] Registered Peer: %s (%s, SNR: %.1f dB)", peer.Name, peer.ID, peer.SnrDb)
					_ = bridge.Broadcast("PEER_REGISTERED", peer)
				}
			}
		}
	}()

	// Graceful shutdown on SIGINT or SIGTERM
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	<-sigChan

	log.Println("[SoundDrop Daemon] Shutting down gracefully...")
	_ = bridge.Close()
	fmt.Println("[SoundDrop Daemon] Stopped.")
}
