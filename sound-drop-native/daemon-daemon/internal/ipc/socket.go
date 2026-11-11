package ipc

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"sync"
	"time"
)

// Message encapsulates structured IPC communication frames
type Message struct {
	Type      string          `json:"type"`      // "COMMAND", "TELEMETRY", "PACKET", "PEER_DISCOVERED"
	Payload   json.RawMessage `json:"payload"`
	Timestamp int64           `json:"timestamp"`
}

// IPCBridge manages local IPC connections
type IPCBridge struct {
	address  string
	listener net.Listener
	clients  map[net.Conn]bool
	mu       sync.RWMutex
	inbound  chan Message
	running  bool
}

// NewIPCBridge initializes an IPC listener on a local loopback port
func NewIPCBridge(port int) (*IPCBridge, error) {
	addr := fmt.Sprintf("127.0.0.1:%d", port)
	l, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("failed to bind IPC listener to %s: %w", addr, err)
	}

	return &IPCBridge{
		address:  addr,
		listener: l,
		clients:  make(map[net.Conn]bool),
		inbound:  make(chan Message, 256),
		running:  true,
	}, nil
}

// Start begins accepting local client connections (e.g. from Tauri desktop UI)
func (b *IPCBridge) Start() {
	go func() {
		for b.running {
			conn, err := b.listener.Accept()
			if err != nil {
				if !b.running {
					return
				}
				continue
			}

			b.mu.Lock()
			b.clients[conn] = true
			b.mu.Unlock()

			go b.handleClient(conn)
		}
	}()
}

func (b *IPCBridge) handleClient(conn net.Conn) {
	defer func() {
		conn.Close()
		b.mu.Lock()
		delete(b.clients, conn)
		b.mu.Unlock()
	}()

	reader := bufio.NewReader(conn)
	for b.running {
		line, err := reader.ReadBytes('\n')
		if err != nil {
			if err != io.EOF {
				// Client disconnected
			}
			return
		}

		var msg Message
		if err := json.Unmarshal(line, &msg); == nil {
			select {
			case b.inbound <- msg:
			default:
				// Dropped if full
			}
		}
	}
}

// Broadcast sends a message to all connected desktop UI clients
func (b *IPCBridge) Broadcast(msgType string, payload any) error {
	rawPayload, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	msg := Message{
		Type:      msgType,
		Payload:   rawPayload,
		Timestamp: time.Now().UnixMilli(),
	}

	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	data = append(data, '\n')

	b.mu.RLock()
	defer b.mu.RUnlock()

	for conn := range b.clients {
		_, _ = conn.Write(data)
	}

	return nil
}

// Inbound returns the receive channel
func (b *IPCBridge) Inbound() <-chan Message {
	return b.inbound
}

// Close closes the IPC bridge
func (b *IPCBridge) Close() error {
	b.running = false
	b.mu.Lock()
	defer b.mu.Unlock()

	for conn := range b.clients {
		conn.Close()
	}
	return b.listener.Close()
}
