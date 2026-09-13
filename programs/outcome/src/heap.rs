//! Bottom-up bump allocator (INFRA-021).
//!
//! The runtime's default `BumpAllocator` hands out memory from the *top* of the heap frame,
//! so a 256 KiB allocator would fault on the very first allocation in any transaction that
//! kept the default 32 KiB frame. This one grows from the bottom: transactions that do not
//! request a larger frame behave exactly as before (32 KiB, then an unmapped-page fault),
//! and callers that need more — compact rng_v2 draws parse a full 8 KiB outcome table with
//! a heap that is never freed — add `ComputeBudgetInstruction::request_heap_frame` (≤ 256 KiB).
//!
//! The first word of the heap stores the bump cursor; `dealloc` is a no-op like the default.

use std::alloc::{GlobalAlloc, Layout};

pub struct BottomUpBumpAllocator {
    pub start: usize,
    pub len: usize,
}

unsafe impl GlobalAlloc for BottomUpBumpAllocator {
    #[inline]
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let cursor_ptr = self.start as *mut usize;
        let mut cursor = *cursor_ptr;
        if cursor == 0 {
            cursor = self.start + core::mem::size_of::<usize>();
        }
        let align = layout.align().max(1);
        let aligned = (cursor + align - 1) & !(align - 1);
        let end = match aligned.checked_add(layout.size()) {
            Some(end) => end,
            None => return core::ptr::null_mut(),
        };
        if end > self.start + self.len {
            return core::ptr::null_mut();
        }
        *cursor_ptr = end;
        aligned as *mut u8
    }

    #[inline]
    unsafe fn dealloc(&self, _ptr: *mut u8, _layout: Layout) {}
}
