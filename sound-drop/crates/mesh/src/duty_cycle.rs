//! Acoustic duty-cycle and energy manager for battery-powered smartphone relays.
//! Prevents microphone battery drain while maintaining reactive mesh listening.

use std::time::{Duration, Instant};

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum PowerProfile {
    Continuous,    // 100% active listening (stationary solar/plugged-in relay)
    EcoRelay,      // 500ms listen / 2000ms sleep (20% duty cycle, ~24h mobile battery)
    UltraLowPower, // 200ms listen / 4800ms sleep (4% duty cycle, ~72h battery)
}

impl PowerProfile {
    pub fn active_duration(&self) -> Duration {
        match self {
            PowerProfile::Continuous => Duration::from_secs(3600),
            PowerProfile::EcoRelay => Duration::from_millis(500),
            PowerProfile::UltraLowPower => Duration::from_millis(200),
        }
    }

    pub fn sleep_duration(&self) -> Duration {
        match self {
            PowerProfile::Continuous => Duration::ZERO,
            PowerProfile::EcoRelay => Duration::from_millis(2000),
            PowerProfile::UltraLowPower => Duration::from_millis(4800),
        }
    }
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum DutyState {
    Listening,
    Sleeping,
}

pub struct DutyCycleManager {
    profile: PowerProfile,
    state: DutyState,
    state_switched_at: Instant,
    force_wake_until: Option<Instant>,
}

impl DutyCycleManager {
    pub fn new(profile: PowerProfile) -> Self {
        Self {
            profile,
            state: DutyState::Listening,
            state_switched_at: Instant::now(),
            force_wake_until: None,
        }
    }

    pub fn profile(&self) -> PowerProfile {
        self.profile
    }

    pub fn set_profile(&mut self, profile: PowerProfile) {
        self.profile = profile;
        self.state = DutyState::Listening;
        self.state_switched_at = Instant::now();
    }

    pub fn is_listening(&mut self) -> bool {
        self.update_state();
        self.state == DutyState::Listening
    }

    /// Wake up immediately upon detecting an acoustic chirp preamble
    pub fn wake_on_chirp(&mut self, hold_duration: Duration) {
        self.state = DutyState::Listening;
        self.force_wake_until = Some(Instant::now() + hold_duration);
    }

    fn update_state(&mut self) {
        let now = Instant::now();

        // Check if under force-wake hold
        if let Some(wake_until) = self.force_wake_until {
            if now < wake_until {
                self.state = DutyState::Listening;
                return;
            } else {
                self.force_wake_until = None;
                self.state_switched_at = now;
            }
        }

        if self.profile == PowerProfile::Continuous {
            self.state = DutyState::Listening;
            return;
        }

        let elapsed = now.duration_since(self.state_switched_at);
        match self.state {
            DutyState::Listening => {
                if elapsed >= self.profile.active_duration() {
                    self.state = DutyState::Sleeping;
                    self.state_switched_at = now;
                }
            }
            DutyState::Sleeping => {
                if elapsed >= self.profile.sleep_duration() {
                    self.state = DutyState::Listening;
                    self.state_switched_at = now;
                }
            }
        }
    }
}
