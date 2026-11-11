package session

import (
	"sync"
	"time"
)

// DeviceState represents the current physical acoustic state
type DeviceState string

const (
	StateIdle           DeviceState = "IDLE"
	StateEmittingPing   DeviceState = "EMITTING_PING"
	StateLockedOnSignal DeviceState = "LOCKED"
	StateDrainingBuffer DeviceState = "DRAINING_BUFFER"
	StateTransmitting   DeviceState = "TRANSMITTING"
)

// Peer represents an acoustically discovered peer node
type Peer struct {
	ID           string    `json:"id"`
	DeviceType   string    `json:"device_type"`
	Name         string    `json:"name"`
	ColorHex     string    `json:"color_hex"`
	SnrDb        float64   `json:"snr_db"`
	LastSeen     time.Time `json:"last_seen"`
	PacketsTotal int       `json:"packets_total"`
	PacketsDone  int       `json:"packets_done"`
}

// SessionManager handles concurrent acoustic state, peer discovery, and ARQ
type SessionManager struct {
	currentState DeviceState
	peers        map[string]*Peer
	activeSession uint8
	pendingAcks  map[int]time.Time
	mu           sync.RWMutex
}

// NewSessionManager creates a new session manager
func NewSessionManager() *SessionManager {
	return &SessionManager{
		currentState: StateIdle,
		peers:        make(map[string]*Peer),
		pendingAcks:  make(map[int]time.Time),
	}
}

// SetState transitions the device state
func (sm *SessionManager) SetState(state DeviceState) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.currentState = state
}

// GetState returns the current device state
func (sm *SessionManager) GetState() DeviceState {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return sm.currentState
}

// RegisterPeer updates or creates an acoustically detected peer
func (sm *SessionManager) RegisterPeer(id, deviceType, name, color string, snrDb float64) *Peer {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	p, exists := sm.peers[id]
	if !exists {
		p = &Peer{
			ID:         id,
			DeviceType: deviceType,
			Name:       name,
			ColorHex:   color,
			SnrDb:      snrDb,
			LastSeen:   time.Now(),
		}
		sm.peers[id] = p
	} else {
		p.LastSeen = time.Now()
		p.SnrDb = snrDb
	}
	return p
}

// GetPeers returns a slice of currently active peers (seen in last 10s)
func (sm *SessionManager) GetPeers() []*Peer {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	now := time.Now()
	active := make([]*Peer, 0, len(sm.peers))
	for _, p := range sm.peers {
		if now.Sub(p.LastSeen) < 10*time.Second {
			active = append(active, p)
		}
	}
	return active
}

// RecordPacketProgress updates packet transmission / reception metrics
func (sm *SessionManager) RecordPacketProgress(peerID string, packetIndex, totalPackets int) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if p, exists := sm.peers[peerID]; exists {
		p.PacketsTotal = totalPackets
		p.PacketsDone = packetIndex + 1
	}
}

// HandleNack queues an automatic packet retransmission in accordance with the Acoustic ARQ protocol
func (sm *SessionManager) HandleNack(packetIndex int) bool {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	sm.pendingAcks[packetIndex] = time.Now()
	return true
}
