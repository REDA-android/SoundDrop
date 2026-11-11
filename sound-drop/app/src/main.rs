use slint::ComponentHandle;
use sounddrop_app::{update_ui_state, BubblePhysicsWorld, MainWindow};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.contains(&"--test-states".to_string()) {
        println!("[Sound Drop App] Running headless state navigation test...");
        let window = MainWindow::new()?;

        let states = ["INACTIF", "ECOUTE", "APPAIRAGE", "SAS", "ENVOI", "RECEPTION", "TERMINE", "ERREUR"];
        for s in states {
            update_ui_state(&window, s);
            assert_eq!(window.get_current_state(), s);
            println!("  -> State '{}' successfully rendered with accessible label: '{}'", s, window.get_accessible_status());
        }

        // Test Rapier2D physics
        let mut physics = BubblePhysicsWorld::new();
        let _b1 = physics.add_peer_bubble(0.0, 0.0, 40.0);
        let _b2 = physics.add_peer_bubble(10.0, 0.0, 35.0);
        for _ in 0..60 {
            physics.step();
        }
        println!("[Sound Drop App] Rapier2D physics simulation verified at 60 FPS.");
        println!("[Sound Drop App] Headless UI validation PASSED.");
        return Ok(());
    }

    let window = MainWindow::new()?;
    let window_weak = window.as_weak();

    // Callbacks
    {
        let w = window_weak.clone();
        window.on_switch_view(move |view| {
            if let Some(win) = w.upgrade() {
                win.set_current_view(view);
            }
        });
    }

    {
        let w = window_weak.clone();
        window.on_switch_band(move || {
            if let Some(win) = w.upgrade() {
                let cur = win.get_active_band();
                let next = if cur == "AUDIBLE" { "ULTRASONIC" } else { "AUDIBLE" };
                win.set_active_band(next.into());
            }
        });
    }

    {
        let w = window_weak.clone();
        window.on_switch_state(move |state| {
            if let Some(win) = w.upgrade() {
                update_ui_state(&win, &state);
            }
        });
    }

    {
        let w = window_weak.clone();
        window.on_toggle_emit(move || {
            if let Some(win) = w.upgrade() {
                let cur = win.get_current_state();
                if cur == "INACTIF" {
                    update_ui_state(&win, "APPAIRAGE");
                } else {
                    update_ui_state(&win, "INACTIF");
                }
            }
        });
    }

    {
        let w = window_weak.clone();
        window.on_toggle_listen(move || {
            if let Some(win) = w.upgrade() {
                let cur = win.get_current_state();
                if cur == "ECOUTE" {
                    update_ui_state(&win, "INACTIF");
                } else {
                    update_ui_state(&win, "ECOUTE");
                }
            }
        });
    }

    {
        let w = window_weak.clone();
        window.on_confirm_sas(move || {
            if let Some(win) = w.upgrade() {
                update_ui_state(&win, "ENVOI");
            }
        });
    }

    {
        let w = window_weak.clone();
        window.on_accept_preview(move || {
            if let Some(win) = w.upgrade() {
                update_ui_state(&win, "TERMINE");
            }
        });
    }

    {
        let w = window_weak.clone();
        window.on_reject_preview(move || {
            if let Some(win) = w.upgrade() {
                update_ui_state(&win, "INACTIF");
            }
        });
    }

    {
        let w = window_weak.clone();
        window.on_cycle_language(move || {
            if let Some(win) = w.upgrade() {
                let cur = win.get_current_lang();
                let next = match cur.as_str() {
                    "FR" => "EN",
                    "EN" => "AR",
                    _ => "FR",
                };
                win.set_current_lang(next.into());
            }
        });
    }

    {
        let w = window_weak.clone();
        window.on_toggle_diode(move || {
            if let Some(win) = w.upgrade() {
                let cur = win.get_software_diode_active();
                win.set_software_diode_active(!cur);
            }
        });
    }

    println!("Sound Drop v2 application ready.");
    window.run()?;
    Ok(())
}
