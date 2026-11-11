//! Java Native Interface (JNI) bindings for Android Kotlin runtime.
//! Matches package `com.sounddrop.core.SoundDropNative`.

use jni::objects::JClass;
use jni::sys::{jbyteArray, jstring};
use jni::JNIEnv;
use sounddrop_crypto::{compute_recipient_hash, EphemeralKeyPair};

#[no_mangle]
pub unsafe extern "system" fn Java_com_sounddrop_core_SoundDropNative_version(
    mut env: JNIEnv,
    _class: JClass,
) -> jstring {
    let output = env.new_string("SoundDrop Native Core 0.2.0 (Rust JNI)").expect("Couldn't create java string");
    output.into_raw()
}

#[no_mangle]
pub unsafe extern "system" fn Java_com_sounddrop_core_SoundDropNative_generateIdentity(
    mut env: JNIEnv,
    _class: JClass,
) -> jbyteArray {
    let keypair = EphemeralKeyPair::generate();
    let pub_bytes = keypair.public_bytes();

    let byte_array = env.new_byte_array(32).expect("Couldn't create byte array");
    env.set_byte_array_region(&byte_array, 0, bytemuck_cast(&pub_bytes))
        .expect("Couldn't copy bytes to java array");
    byte_array.into_raw()
}

#[no_mangle]
pub unsafe extern "system" fn Java_com_sounddrop_core_SoundDropNative_computeRecipientHash(
    mut env: JNIEnv,
    _class: JClass,
    public_key: jbyteArray,
) -> jbyteArray {
    let mut key_buf = [0i8; 32];
    env.get_byte_array_region(&unsafe { jni::objects::JByteArray::from_raw(public_key) }, 0, &mut key_buf)
        .expect("Couldn't read public key array");

    let mut key_u8 = [0u8; 32];
    for i in 0..32 {
        key_u8[i] = key_buf[i] as u8;
    }

    let hash = compute_recipient_hash(&key_u8);
    let mut hash_i8 = [0i8; 4];
    for i in 0..4 {
        hash_i8[i] = hash[i] as i8;
    }

    let byte_array = env.new_byte_array(4).expect("Couldn't create hash array");
    env.set_byte_array_region(&byte_array, 0, &hash_i8)
        .expect("Couldn't copy hash to java array");
    byte_array.into_raw()
}

fn bytemuck_cast(src: &[u8; 32]) -> &[i8; 32] {
    unsafe { std::mem::transmute(src) }
}
