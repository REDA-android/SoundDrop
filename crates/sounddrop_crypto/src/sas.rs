/// Phonetically distinct, curated wordlist for acoustic and visual Short Authentication String (SAS) verification.
/// 256 carefully selected phonetically distinct words (1 byte -> 1 word).
pub const SAS_WORDLIST: [&str; 256] = [
    "ACORN", "ALARM", "ALPHA", "AMBER", "ANCHOR", "ANVIL", "APOLLO", "ARCHER",
    "ARROW", "ATLAS", "ATOM", "AURORA", "AVENUE", "AZTEC", "BADGE", "BANNER",
    "BEACON", "BISON", "BLAZE", "BONUS", "BOXER", "BRONZE", "CABLE", "CACTUS",
    "CANYON", "CARBON", "CASTLE", "CEDAR", "CHAMP", "CHERRY", "CHISEL", "CHROME",
    "CIDER", "CIRCUS", "CLOVER", "COBALT", "COMET", "CORAL", "CRATER", "CRYSTAL",
    "DAGGER", "DELTA", "DESERT", "DIAMOND", "DIVIDE", "DOLPHIN", "DRAGON", "DRIFT",
    "EAGLE", "ECHO", "EMBER", "ENGINE", "ENVOY", "EXODUS", "FALCON", "FEATHER",
    "FLAME", "FLINT", "FOREST", "FORGE", "FOSSIL", "FOX", "FROST", "GALAXY",
    "GARNET", "GEYSER", "GLIDER", "GLOBAL", "GRANITE", "HARBOR", "HAVEN", "HAWK",
    "HELMET", "HERON", "HORIZON", "HUNTER", "HYDRA", "ICEBERG", "ICON", "IMPACT",
    "INDIGO", "ISLAND", "IVORY", "JAGUAR", "JADE", "JET", "JUNGLE", "KANGAROO",
    "KEEPER", "KINETIC", "KNIGHT", "LADDER", "LANCE", "LASER", "LEGEND", "LEMON",
    "LEOPARD", "LEVEL", "LIGHTNING", "LION", "LIZARD", "LODGE", "LOTUS", "LUNAR",
    "MAGNET", "MAMMOT", "MANTIS", "MARBLE", "MATRIX", "METEOR", "MIRAGE", "MONARCH",
    "MYSTIC", "NATIVE", "NEBULA", "NEXUS", "NICKEL", "NOMAD", "NOVA", "OASIS",
    "OBSIDIAN", "OCEAN", "OMEGA", "ONYX", "OPAL", "ORBIT", "ORION", "OSPREY",
    "OUTLAW", "PACIFIC", "PANTHER", "PARAGON", "PATROL", "PEBBLE", "PELICAN", "PHOENIX",
    "PILOT", "PINE", "PIRATE", "PISTON", "PLANET", "PLATINUM", "PLOVER", "POLAR",
    "PORTAL", "PRISM", "PULSE", "PYTHON", "QUARTZ", "RADAR", "RANGER", "RAPTOR",
    "RAVEN", "REACTOR", "REDWOOD", "RELIC", "RESCUE", "RIDGE", "RIVER", "ROCKET",
    "RUBY", "RUNNER", "SABER", "SAFARI", "SAILOR", "SAPPHIRE", "SATURN", "SCOUT",
    "SHADOW", "SHERIFF", "SHIELD", "SIERRA", "SILVER", "SIREN", "SKYLARK", "SOLAR",
    "SPARK", "SPARROW", "SPHINX", "SPIRIT", "SPRING", "STALKER", "STATIC", "STEEL",
    "STONE", "STORM", "STRYKER", "SUMMIT", "SUNSET", "SURGE", "SWALLOW", "SWORD",
    "TACTIC", "TALON", "TARGET", "TEMPLE", "THUNDER", "TIGER", "TIMBER", "TITAN",
    "TOPAZ", "TORNADO", "TORRENT", "TRACKER", "TRACER", "TROPHY", "TUNNEL", "TURBO",
    "TYPHOON", "ULTRA", "VALLEY", "VALOR", "VECTOR", "VELOCITY", "VENOM", "VENTURE",
    "VESSEL", "VINTAGE", "VIPER", "VORTEX", "VOYAGE", "VULTURE", "WALKER", "WARRIOR",
    "WATCHMAN", "WAVE", "WILDCAT", "WILLOW", "WIND", "WIZARD", "WOLF", "ZENITH",
    "ZERO", "ZEPHYR", "ZODIAC", "ZONE", "ALBATROSS", "BLIZZARD", "COSMOS", "DUNE",
    "ECLIPSE", "HORNET", "JUPITER", "LAGOON", "METEORITE", "NAVIGATOR", "OCTOPUS", "PEGASUS",
    "QUASAR", "RADICAL", "SUPERNOVA", "TSUNAMI", "URANIUM", "VOLCANO", "WHIRLWIND", "YUKON",
];

/// Formats raw 32-byte hash output into human-readable Short Authentication Strings.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SasCode {
    /// 6-digit numeric PIN: e.g. "582-941"
    pub pin: String,
    /// 4-word mnemonic code: e.g. "COBALT - RIVER - EAGLE - SHADOW"
    pub words: String,
}

impl SasCode {
    pub fn from_digest(digest: &[u8; 32]) -> Self {
        // Derive 6-digit PIN from first 4 bytes
        let num = u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]]) % 1_000_000;
        let pin = format!("{:03}-{:03}", num / 1000, num % 1000);

        // Derive 4 words from bytes 4, 5, 6, 7
        let w1 = SAS_WORDLIST[digest[4] as usize];
        let w2 = SAS_WORDLIST[digest[5] as usize];
        let w3 = SAS_WORDLIST[digest[6] as usize];
        let w4 = SAS_WORDLIST[digest[7] as usize];
        let words = format!("{} - {} - {} - {}", w1, w2, w3, w4);

        Self { pin, words }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sas_code_generation_deterministic() {
        let digest = [0x5Au8; 32];
        let sas1 = SasCode::from_digest(&digest);
        let sas2 = SasCode::from_digest(&digest);

        assert_eq!(sas1, sas2);
        assert_eq!(sas1.pin.len(), 7); // "XXX-XXX"
        assert!(sas1.words.contains(" - "));
    }

    #[test]
    fn test_sas_differs_on_tamper() {
        let d1 = [0x42u8; 32];
        let mut d2 = [0x42u8; 32];
        d2[0] ^= 0x01; // 1 bit flipped by attacker

        let sas1 = SasCode::from_digest(&d1);
        let sas2 = SasCode::from_digest(&d2);

        assert_ne!(sas1.pin, sas2.pin, "PIN must differ when transcript is altered");
    }
}
