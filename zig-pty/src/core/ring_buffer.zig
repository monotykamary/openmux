//! Ring Buffer - Single producer single consumer with backpressure
//! Lock-free on fast path; uses condition variable when buffer is full

const std = @import("std");

pub const RING_BUFFER_SIZE: usize = 256 * 1024; // 256KB ring buffer

pub const RingBuffer = struct {
    data: [RING_BUFFER_SIZE]u8,
    write_pos: std.atomic.Value(usize),
    read_pos: std.atomic.Value(usize),
    // Condition variable for producer to wait when buffer is full
    mutex: std.Thread.Mutex,
    not_full: std.Thread.Condition,

    pub fn init() RingBuffer {
        return .{
            .data = undefined,
            .write_pos = std.atomic.Value(usize).init(0),
            .read_pos = std.atomic.Value(usize).init(0),
            .mutex = .{},
            .not_full = .{},
        };
    }

    pub fn availableSpace(self: *RingBuffer) usize {
        const w = self.write_pos.load(.acquire);
        const r = self.read_pos.load(.acquire);
        return if (w >= r)
            RING_BUFFER_SIZE - 1 - (w - r)
        else
            r - w - 1;
    }

    /// Producer: write data to buffer, returns amount written
    pub fn write(self: *RingBuffer, src: []const u8) usize {
        const w = self.write_pos.load(.acquire);
        const r = self.read_pos.load(.acquire);

        // Available space (leave 1 byte to distinguish full from empty)
        const space = if (w >= r)
            RING_BUFFER_SIZE - 1 - (w - r)
        else
            r - w - 1;

        const to_write = @min(src.len, space);
        if (to_write == 0) return 0;

        // Write data, handling wrap-around
        const first_chunk = @min(to_write, RING_BUFFER_SIZE - w);
        @memcpy(self.data[w..][0..first_chunk], src[0..first_chunk]);

        if (to_write > first_chunk) {
            const second_chunk = to_write - first_chunk;
            @memcpy(self.data[0..second_chunk], src[first_chunk..][0..second_chunk]);
        }

        self.write_pos.store((w + to_write) % RING_BUFFER_SIZE, .release);
        return to_write;
    }

    /// Consumer: read data from buffer into dst, returns amount read
    pub fn read(self: *RingBuffer, dst: []u8) usize {
        const w = self.write_pos.load(.acquire);
        const r = self.read_pos.load(.acquire);

        // Available data
        const data_available = if (w >= r) w - r else RING_BUFFER_SIZE - r + w;

        const to_read = @min(dst.len, data_available);
        if (to_read == 0) return 0;

        // Read data, handling wrap-around
        const first_chunk = @min(to_read, RING_BUFFER_SIZE - r);
        @memcpy(dst[0..first_chunk], self.data[r..][0..first_chunk]);

        if (to_read > first_chunk) {
            const second_chunk = to_read - first_chunk;
            @memcpy(dst[first_chunk..][0..second_chunk], self.data[0..second_chunk]);
        }

        self.read_pos.store((r + to_read) % RING_BUFFER_SIZE, .release);
        return to_read;
    }

    pub fn available(self: *RingBuffer) usize {
        const w = self.write_pos.load(.acquire);
        const r = self.read_pos.load(.acquire);
        return if (w >= r) w - r else RING_BUFFER_SIZE - r + w;
    }
};
