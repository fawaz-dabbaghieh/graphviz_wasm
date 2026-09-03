cmake_minimum_required(VERSION 3.10)
project(bandage-layout-js)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Check if building with Emscripten
if(EMSCRIPTEN)
    message(STATUS "Building with Emscripten for WebAssembly")
else()
    message(STATUS "Building native binary (not for web)")
endif()

# OGDF is built separately by layout_wasm/build.sh. Cache variables keep the
# application CMake project independent of the dependency's build location.
set(OGDF_INCLUDE_DIR "" CACHE PATH "Path to the OGDF source include directory")
set(OGDF_GENERATED_INCLUDE_DIR "" CACHE PATH "Path to generated OGDF headers")
set(OGDF_LIBRARY "" CACHE FILEPATH "Path to the OGDF static library")
set(COIN_LIBRARY "" CACHE FILEPATH "Path to the COIN static library")

foreach(required_path
        OGDF_INCLUDE_DIR
        OGDF_GENERATED_INCLUDE_DIR
        OGDF_LIBRARY
        COIN_LIBRARY)
    if(NOT EXISTS "${${required_path}}")
        message(FATAL_ERROR
            "${required_path} does not exist: ${${required_path}}. "
            "Run layout_wasm/build.sh to configure the dependency paths.")
    endif()
endforeach()

# Source files
set(SOURCES
    src/graphlayout.cpp
    src/bindings.cpp
)

# Create executable/library
if(EMSCRIPTEN)
    add_executable(bandage-layout ${SOURCES})
    target_include_directories(bandage-layout PRIVATE
        "${CMAKE_SOURCE_DIR}/include"
        "${OGDF_INCLUDE_DIR}"
        "${OGDF_GENERATED_INCLUDE_DIR}"
    )
    target_link_libraries(bandage-layout PRIVATE
        "${OGDF_LIBRARY}"
        "${COIN_LIBRARY}"
    )
    target_compile_options(bandage-layout PRIVATE -O3)
    target_link_options(bandage-layout PRIVATE
        -O3
        "-sWASM=1"
        "-sALLOW_MEMORY_GROWTH=1"
        "-sMODULARIZE=1"
        "-sEXPORT_ES6=1"
        "-sEXPORT_NAME=createBandageLayoutModule"
        "-sENVIRONMENT=web,worker"
        --bind
    )

    # Keep generated files in the selected binary directory; build.sh copies
    # the final JS/WASM pair into the runtime js directory.
    set_target_properties(bandage-layout PROPERTIES
        SUFFIX ".js"
    )
else()
    add_library(bandage-layout STATIC ${SOURCES})
    target_include_directories(bandage-layout PRIVATE
        "${CMAKE_SOURCE_DIR}/include"
        "${OGDF_INCLUDE_DIR}"
        "${OGDF_GENERATED_INCLUDE_DIR}"
    )
    target_link_libraries(bandage-layout PRIVATE
        "${OGDF_LIBRARY}"
        "${COIN_LIBRARY}"
    )
endif()

# Installation
install(TARGETS bandage-layout
        RUNTIME DESTINATION ${CMAKE_SOURCE_DIR}/js
        LIBRARY DESTINATION ${CMAKE_SOURCE_DIR}/js
        ARCHIVE DESTINATION ${CMAKE_SOURCE_DIR}/js)
