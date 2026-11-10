cmake_minimum_required(VERSION 3.22.1)
project(sounddrop_oboe LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Find or fetch Google Oboe (C++ high-performance audio library for Android)
find_package(oboe REQUIRED CONFIG)

# Include directories
include_directories(
    ${CMAKE_CURRENT_SOURCE_DIR}/cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../../crates/sounddrop_audio_io/src
)

# Shared library for Android JNI and Oboe native audio stream
add_library(sounddrop_oboe SHARED
    cpp/sounddrop_oboe_engine.cpp
)

target_link_libraries(sounddrop_oboe
    PRIVATE
    oboe::oboe
    log
    android
)
