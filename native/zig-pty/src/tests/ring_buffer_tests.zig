//! Ring Buffer Tests
//! Tests for the lock-free SPSC ring buffer implementation.

const std = @import("std");
const ring_buffer = @import("../core/ring_buffer.zig");

// ============================================================================
// Basic Operations Tests
// ============================================================================

test "ring buffer basic operations" {
    var ring = ring_buffer.RingBuffer.init();

    // Write some data
    const data = "Hello, World!";
    const written = ring.write(data);
    try std.testing.expectEqual(data.len, written);

    // Check available data
    try std.testing.expectEqual(data.len, ring.available());

    // Read it back
    var buf: [64]u8 = undefined;
    const read_count = ring.read(&buf);
    try std.testing.expectEqual(data.len, read_count);
    try std.testing.expectEqualStrings(data, buf[0..read_count]);

    // Buffer should be empty now
    try std.testing.expectEqual(@as(usize, 0), ring.available());
}

test "ring buffer empty read" {
    var ring = ring_buffer.RingBuffer.init();

    var buf: [64]u8 = undefined;
    const read_count = ring.read(&buf);
    try std.testing.expectEqual(@as(usize, 0), read_count);
}

// ============================================================================
// Wrap Around Tests
// ============================================================================

test "ring buffer wrap around" {
    var ring = ring_buffer.RingBuffer.init();

    // Fill most of the buffer
    var large_data: [ring_buffer.RING_BUFFER_SIZE - 100]u8 = undefined;
    @memset(&large_data, 'A');
    _ = ring.write(&large_data);

    // Read most of it
    var read_buf: [ring_buffer.RING_BUFFER_SIZE - 200]u8 = undefined;
    _ = ring.read(&read_buf);

    // Now write more data that will wrap around
    var wrap_data: [200]u8 = undefined;
    @memset(&wrap_data, 'B');
    const written = ring.write(&wrap_data);
    try std.testing.expectEqual(@as(usize, 200), written);

    // Read and verify
    var final_buf: [300]u8 = undefined;
    const total_read = ring.read(&final_buf);
    try std.testing.expect(total_read > 0);
}

// ============================================================================
// Capacity Tests
// ============================================================================

test "ring buffer full condition" {
    var ring = ring_buffer.RingBuffer.init();

    // Fill the buffer completely (leave 1 byte as per implementation)
    var full_data: [ring_buffer.RING_BUFFER_SIZE - 1]u8 = undefined;
    @memset(&full_data, 'X');
    const written = ring.write(&full_data);
    try std.testing.expectEqual(ring_buffer.RING_BUFFER_SIZE - 1, written);

    // Available space should be 0
    try std.testing.expectEqual(@as(usize, 0), ring.availableSpace());

    // Additional writes should return 0
    const more = ring.write("more");
    try std.testing.expectEqual(@as(usize, 0), more);
}

test "ring buffer partial write when almost full" {
    var ring = ring_buffer.RingBuffer.init();

    // Fill most of the buffer
    var large_data: [ring_buffer.RING_BUFFER_SIZE - 10]u8 = undefined;
    @memset(&large_data, 'Y');
    _ = ring.write(&large_data);

    // Try to write more than available
    const result = ring.write("this is more than 9 bytes");
    // Should only write what fits (9 bytes, since 1 is reserved)
    try std.testing.expect(result < "this is more than 9 bytes".len);
}

// ============================================================================
// Multiple Read/Write Cycles
// ============================================================================

test "ring buffer multiple read write cycles" {
    var ring = ring_buffer.RingBuffer.init();
    var buf: [256]u8 = undefined;

    // Multiple cycles of write/read
    var i: usize = 0;
    while (i < 100) : (i += 1) {
        const data = "cycle data";
        const written = ring.write(data);
        try std.testing.expectEqual(data.len, written);

        const read_count = ring.read(&buf);
        try std.testing.expectEqual(data.len, read_count);
        try std.testing.expectEqualStrings(data, buf[0..read_count]);
    }
}

test "ring buffer accumulate then drain" {
    var ring = ring_buffer.RingBuffer.init();

    // Write multiple chunks
    _ = ring.write("chunk1-");
    _ = ring.write("chunk2-");
    _ = ring.write("chunk3");

    // Check total available
    try std.testing.expectEqual(@as(usize, 20), ring.available());

    // Read all at once
    var buf: [64]u8 = undefined;
    const read_count = ring.read(&buf);
    try std.testing.expectEqual(@as(usize, 20), read_count);
    try std.testing.expectEqualStrings("chunk1-chunk2-chunk3", buf[0..read_count]);
}
