//! Sound Drop v2 Native UI library exports for integration and headless testing.

slint::include_modules!();

pub use slint::ComponentHandle;
use rapier2d::prelude::*;

pub struct BubblePhysicsWorld {
    pub rigid_body_set: RigidBodySet,
    pub collider_set: ColliderSet,
    pub physics_pipeline: PhysicsPipeline,
    pub gravity: Vector<Real>,
    pub integration_parameters: IntegrationParameters,
    pub island_manager: IslandManager,
    pub broad_phase: DefaultBroadPhase,
    pub narrow_phase: NarrowPhase,
    pub impulse_joint_set: ImpulseJointSet,
    pub multibody_joint_set: MultibodyJointSet,
    pub ccd_solver: CCDSolver,
}

impl BubblePhysicsWorld {
    pub fn new() -> Self {
        Self {
            rigid_body_set: RigidBodySet::new(),
            collider_set: ColliderSet::new(),
            physics_pipeline: PhysicsPipeline::new(),
            gravity: vector![0.0, 0.0],
            integration_parameters: IntegrationParameters::default(),
            island_manager: IslandManager::new(),
            broad_phase: DefaultBroadPhase::new(),
            narrow_phase: NarrowPhase::new(),
            impulse_joint_set: ImpulseJointSet::new(),
            multibody_joint_set: MultibodyJointSet::new(),
            ccd_solver: CCDSolver::new(),
        }
    }

    pub fn add_peer_bubble(&mut self, x: f32, y: f32, radius: f32) -> RigidBodyHandle {
        let rigid_body = RigidBodyBuilder::dynamic()
            .translation(vector![x, y])
            .linear_damping(1.5)
            .build();
        let handle = self.rigid_body_set.insert(rigid_body);
        let collider = ColliderBuilder::ball(radius)
            .restitution(0.7)
            .friction(0.2)
            .build();
        self.collider_set.insert_with_parent(collider, handle, &mut self.rigid_body_set);
        handle
    }

    pub fn step(&mut self) {
        self.physics_pipeline.step(
            &self.gravity,
            &self.integration_parameters,
            &mut self.island_manager,
            &mut self.broad_phase,
            &mut self.narrow_phase,
            &mut self.rigid_body_set,
            &mut self.collider_set,
            &mut self.impulse_joint_set,
            &mut self.multibody_joint_set,
            &mut self.ccd_solver,
            None,
            &(),
            &(),
        );
    }
}

pub fn update_ui_state(window: &MainWindow, state: &str) {
    window.set_current_state(state.into());
    match state {
        "INACTIF" => {
            window.set_state_text("Prêt pour le transfert acoustique".into());
            window.set_accessible_status("Système inactif. Prêt à émettre ou recevoir.".into());
        }
        "ECOUTE" => {
            window.set_state_text("Radar en écoute acoustique...".into());
            window.set_accessible_status("Microphone en écoute active d'ondes acoustiques.".into());
        }
        "APPAIRAGE" => {
            window.set_state_text("Appairage en cours — Rapprochez les appareils".into());
            window.set_accessible_status("Émission du préambule chirp pour appairage.".into());
        }
        "SAS" => {
            window.set_state_text("Vérification du code SAS".into());
            window.set_accessible_status("Vérification du code court à 6 chiffres affiché.".into());
        }
        "ENVOI" => {
            window.set_state_text("Envoi des données par modulation MFSK".into());
            window.set_accessible_status("Transmission des trames de données audio en cours.".into());
            window.set_transfer_progress(0.45);
        }
        "RECEPTION" => {
            window.set_state_text("Réception d'un aperçu entrant".into());
            window.set_accessible_status("Aperçu de miniature floue reçu. Choix d'accepter ou refuser.".into());
            window.set_transfer_progress(0.75);
        }
        "TERMINE" => {
            window.set_state_text("Transfert acoustique terminé !".into());
            window.set_accessible_status("Transfert réussi et vérifié par CRC et AEAD.".into());
            window.set_transfer_progress(1.0);
        }
        "ERREUR" => {
            window.set_state_text("Attention : perturbation acoustique".into());
            window.set_accessible_status("Erreur : trop de bruit ou volume insuffisant.".into());
        }
        _ => {}
    }
}
