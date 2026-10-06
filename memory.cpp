/* USB EHCI Host for Teensy 3.6
 * Copyright 2017 Paul Stoffregen (paul@pjrc.com)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the
 * "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions:
 *
 * The above copyright notice and this permission notice shall be included
 * in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
 * OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 * IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
 * CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
 * TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

#include <Arduino.h>
#include "USBHost_t36.h"  // Read this header first for key info
#include <string.h>

struct USBErrorRecord {
	uint32_t magic;
	USBHost::DiagnosticInfo info;
};
static constexpr uint32_t usb_error_magic = 0x55444231;
#if defined(__IMXRT1062__)
DMAMEM static USBErrorRecord usb_error_record __attribute__((aligned(32)));
#else
static USBErrorRecord usb_error_record;
#endif
static bool usb_error_recorded_this_boot = false;

struct USBProgressRecord {
	uint32_t magic;
	USBHost::DiagnosticProgress info;
};
static constexpr uint32_t usb_progress_magic = 0x55445031;
#if defined(__IMXRT1062__)
DMAMEM static USBProgressRecord usb_progress_record __attribute__((aligned(32)));
#else
static USBProgressRecord usb_progress_record;
#endif
static USBHost::DiagnosticProgress usb_previous_progress = {};

void USBHost::beginDiagnosticProgress()
{
	const bool irq_was_enabled = __irq_enabled();
	__disable_irq();
	usb_previous_progress = {};
	if (usb_progress_record.magic == usb_progress_magic &&
		static_cast<uint8_t>(usb_progress_record.info.phase) <= static_cast<uint8_t>(DiagnosticPhase::MenuTicks)) {
		usb_previous_progress = usb_progress_record.info;
	}
	if (irq_was_enabled) __enable_irq();
}

void USBHost::setDiagnosticPhase(DiagnosticPhase phase)
{
	const bool irq_was_enabled = __irq_enabled();
	__disable_irq();
	usb_progress_record.magic = 0;
	usb_progress_record.info.at_ms = millis();
	usb_progress_record.info.phase = phase;
	usb_progress_record.magic = usb_progress_magic;
	#if defined(__IMXRT1062__)
		arm_dcache_flush(&usb_progress_record, sizeof(usb_progress_record));
	#endif
	if (irq_was_enabled) __enable_irq();
}

USBHost::DiagnosticProgress USBHost::getPreviousDiagnosticProgress()
{
	const bool irq_was_enabled = __irq_enabled();
	__disable_irq();
	const DiagnosticProgress info = usb_previous_progress;
	if (irq_was_enabled) __enable_irq();
	return info;
}

const char *USBHost::diagnosticPhaseName(DiagnosticPhase phase)
{
	switch (phase) {
		case DiagnosticPhase::None: return "No retained phase";
		case DiagnosticPhase::Loop: return "Other loop work";
		case DiagnosticPhase::USBTask: return "Usb.Task";
		case DiagnosticPhase::PCUSBRead: return "PC USB MIDI read";
		case DiagnosticPhase::BehaviourReads: return "Behaviour reads";
		case DiagnosticPhase::BehaviourLoops: return "Behaviour loops";
		case DiagnosticPhase::MIDIReconnect: return "USB MIDI reconnect";
		case DiagnosticPhase::SerialReconnect: return "USB serial reconnect";
		case DiagnosticPhase::MenuInputs: return "Menu inputs";
		case DiagnosticPhase::MenuDisplay: return "Menu display";
		case DiagnosticPhase::CVInputs: return "CV inputs";
		case DiagnosticPhase::APCDisplay: return "APC display send";
		case DiagnosticPhase::Keyboard: return "Keyboard processing";
		case DiagnosticPhase::LoopComplete: return "Loop completed";
		case DiagnosticPhase::RetentionTest: return "Retention test";
		case DiagnosticPhase::SerialIO: return "Serial I/O";
		case DiagnosticPhase::ClockUpdate: return "Clock/menu tick update";
		case DiagnosticPhase::GateUpdate: return "Gate update";
		case DiagnosticPhase::TapTempo: return "Tap tempo update";
		case DiagnosticPhase::ViewerCommands: return "Viewer commands";
		case DiagnosticPhase::CVClock: return "CV clock handling";
		case DiagnosticPhase::ClockTicks: return "Clock tick polling";
		case DiagnosticPhase::MenuTicks: return "Menu tick callbacks";
	}
	return "Unknown";
}

USBHost::DiagnosticInfo USBHost::getDiagnosticInfo()
{
	const bool irq_was_enabled = __irq_enabled();
	__disable_irq();
	DiagnosticInfo info = {};
	if (usb_error_record.magic == usb_error_magic) {
		info = usb_error_record.info;
		info.previous_boot = !usb_error_recorded_this_boot;
	}
	if (irq_was_enabled) __enable_irq();
	return info;
}

void USBHost::recordDiagnosticError(DiagnosticError error, const Device_t *device, uint32_t detail)
{
	const bool irq_was_enabled = __irq_enabled();
	__disable_irq();
	DiagnosticInfo info = {};
	info.count = usb_error_record.magic == usb_error_magic ? usb_error_record.info.count + 1 : 1;
	info.at_ms = millis();
	info.detail = detail;
	info.error = error;
	if (device != nullptr) {
		info.vid = device->idVendor;
		info.pid = device->idProduct;
		info.state = device->enum_state;
		info.address = device->address;
		info.hub = device->hub_address;
		info.port = device->hub_port;
	}
	usb_error_record.magic = 0;
	usb_error_record.info = info;
	usb_error_record.magic = usb_error_magic;
	usb_error_recorded_this_boot = true;
	#if defined(__IMXRT1062__)
		arm_dcache_flush(&usb_error_record, sizeof(usb_error_record));
	#endif
	if (irq_was_enabled) __enable_irq();
}

void USBHost::clearDiagnosticInfo()
{
	const bool irq_was_enabled = __irq_enabled();
	__disable_irq();
	usb_error_record.magic = 0;
	usb_error_recorded_this_boot = false;
	#if defined(__IMXRT1062__)
		arm_dcache_flush(&usb_error_record, sizeof(usb_error_record));
	#endif
	if (irq_was_enabled) __enable_irq();
}

const char *USBHost::diagnosticErrorName(DiagnosticError error)
{
	switch (error) {
		case DiagnosticError::None: return "None";
		case DiagnosticError::DevicePool: return "Device pool exhausted";
		case DiagnosticError::PipePool: return "Pipe pool exhausted";
		case DiagnosticError::TransferPool: return "Transfer pool exhausted";
		case DiagnosticError::EnumerationTransfer: return "Enumeration USB error";
		case DiagnosticError::EnumerationDescriptor: return "Invalid USB descriptor";
		case DiagnosticError::ControlQueue: return "Control queue failed";
		case DiagnosticError::SystemError: return "EHCI system error";
		case DiagnosticError::DevicePoolCorruption: return "Device free-list corrupt";
		case DiagnosticError::PipePoolCorruption: return "Pipe free-list corrupt";
		case DiagnosticError::TransferPoolCorruption: return "Transfer free-list corrupt";
		case DiagnosticError::StringPoolCorruption: return "String free-list corrupt";
		case DiagnosticError::TransferDoubleFree: return "Transfer double free";
		case DiagnosticError::EndpointTransfer: return "Endpoint transfer halted";
	}
	return "Unknown";
}

// Memory allocation for Device_t, Pipe_t and Transfer_t structures.
//
// To provide an Arduino-friendly experience, the memory allocation of
// these item is primarily done by the instances of device driver objects,
// which are typically created as static objects near the beginning of
// the Arduino sketch.  Static allocation allows Arduino's memory usage
// summary to accurately show the amount of RAM this library is using.
// Users can choose which devices they wish to support and how many of
// each by creating more object instances.
//
// Device driver objects "contribute" their copies of these structures.
// When ehci.cpp allocates Pipe_t and Transfer_t, or enumeration.cpp
// allocates Device_t, the memory actually comes from these structures
// physically located within the device driver instances.  The usage
// model looks like traditional malloc/free dynamic memory on the heap,
// but in fact it's a simple memory pool from the drivers.
//
// Timing is deterministic and fast, because each pool allocates only
// a single fixed size object.  In theory, each driver should contribute
// the number of items it will use, so we should not ever end up with
// a situation where an item can't be allocated when it's needed.  Well,
// unless there's a bug or oversight...


// Lists of "free" memory
static Device_t * free_Device_list = NULL;
static Pipe_t * free_Pipe_list = NULL;
static Transfer_t * free_Transfer_list = NULL;
static strbuf_t * free_strbuf_list = NULL;
static uint32_t contributed_devices = 0;
static uint32_t contributed_pipes = 0;
static uint32_t contributed_transfers = 0;
static uint32_t contributed_strings = 0;
// A small amount of non-driver memory, just to get things started
// TODO: is this really necessary?  Can these be eliminated, so we
// use only memory from the drivers?
static Device_t memory_Device[1];
static Pipe_t memory_Pipe[1] __attribute__ ((aligned(32)));
static Transfer_t memory_Transfer[4] __attribute__ ((aligned(32)));

void USBHost::init_Device_Pipe_Transfer_memory(void)
{
	contribute_Devices(memory_Device, sizeof(memory_Device)/sizeof(Device_t));
	contribute_Pipes(memory_Pipe, sizeof(memory_Pipe)/sizeof(Pipe_t));
	contribute_Transfers(memory_Transfer, sizeof(memory_Transfer)/sizeof(Transfer_t));
}

Device_t * USBHost::allocate_Device(void)
{
	const bool irq_was_enabled = __irq_enabled();
	__disable_irq();
	Device_t *device = free_Device_list;
	if (device) free_Device_list = *(Device_t **)device;
	else recordDiagnosticError(DiagnosticError::DevicePool);
	if (irq_was_enabled) __enable_irq();
	return device;
}

void USBHost::free_Device(Device_t *device)
{
	const bool irq_was_enabled = __irq_enabled();
	__disable_irq();
	*(Device_t **)device = free_Device_list;
	free_Device_list = device;
	if (irq_was_enabled) __enable_irq();
}

Pipe_t * USBHost::allocate_Pipe(void)
{
	const bool irq_was_enabled = __irq_enabled();
	__disable_irq();
	Pipe_t *pipe = free_Pipe_list;
	if (pipe) free_Pipe_list = *(Pipe_t **)pipe;
	else recordDiagnosticError(DiagnosticError::PipePool);
	if (irq_was_enabled) __enable_irq();
	return pipe;
}

void USBHost::free_Pipe(Pipe_t *pipe)
{
	const bool irq_was_enabled = __irq_enabled();
	__disable_irq();
	*(Pipe_t **)pipe = free_Pipe_list;
	free_Pipe_list = pipe;
	if (irq_was_enabled) __enable_irq();
}

Transfer_t * USBHost::allocate_Transfer(void)
{
	const bool irq_was_enabled = __irq_enabled();
	__disable_irq();
	Transfer_t *transfer = free_Transfer_list;
	if (transfer) free_Transfer_list = *(Transfer_t **)transfer;
	else recordDiagnosticError(DiagnosticError::TransferPool);
	if (irq_was_enabled) __enable_irq();
	return transfer;
}

__attribute__((noinline))
void USBHost::free_Transfer(Transfer_t *transfer)
{
	const bool irq_was_enabled = __irq_enabled();
	__disable_irq();
	Transfer_t *node = free_Transfer_list;
	uint32_t count = 0;
	while (node != nullptr) {
		const uintptr_t address = reinterpret_cast<uintptr_t>(node);
		if (address % alignof(Transfer_t) != 0 || count >= contributed_transfers) {
			recordDiagnosticError(DiagnosticError::TransferPoolCorruption, nullptr, static_cast<uint32_t>(address));
			if (irq_was_enabled) __enable_irq();
			return;
		}
		if (node == transfer) {
			const uintptr_t caller = reinterpret_cast<uintptr_t>(__builtin_extract_return_addr(__builtin_return_address(0)));
			recordDiagnosticError(DiagnosticError::TransferDoubleFree, nullptr, static_cast<uint32_t>(caller));
			if (irq_was_enabled) __enable_irq();
			return;
		}
		Transfer_t *next;
		memcpy(&next, node, sizeof(next));
		node = next;
		++count;
	}
	*(Transfer_t **)transfer = free_Transfer_list;
	free_Transfer_list = transfer;
	if (irq_was_enabled) __enable_irq();
}

strbuf_t * USBHost::allocate_string_buffer(void)
{
	const bool irq_was_enabled = __irq_enabled();
	__disable_irq();
	strbuf_t *strbuf = free_strbuf_list;
	if (strbuf) {
		free_strbuf_list = *(strbuf_t **)strbuf;
		strbuf->iStrings[strbuf_t::STR_ID_MAN] = 0;  // Set indexes into string buffer to say not there...
		strbuf->iStrings[strbuf_t::STR_ID_PROD] = 0;
		strbuf->iStrings[strbuf_t::STR_ID_SERIAL] = 0;
		strbuf->buffer[0] = 0;	// have trailing NULL..
	} 
	if (irq_was_enabled) __enable_irq();
	return strbuf;
}

void USBHost::free_string_buffer(strbuf_t *strbuf) 
{
	const bool irq_was_enabled = __irq_enabled();
	__disable_irq();
	*(strbuf_t **)strbuf = free_strbuf_list;
	free_strbuf_list = strbuf;
	if (irq_was_enabled) __enable_irq();
}

void USBHost::contribute_Devices(Device_t *devices, uint32_t num)
{
	contributed_devices += num;
	Device_t *end = devices + num;
	for (Device_t *device = devices ; device < end; device++) {
		free_Device(device);
	}
}

void USBHost::contribute_Pipes(Pipe_t *pipes, uint32_t num)
{
	contributed_pipes += num;
	Pipe_t *end = pipes + num;
	for (Pipe_t *pipe = pipes; pipe < end; pipe++) {
		free_Pipe(pipe);
	}

}

void USBHost::contribute_Transfers(Transfer_t *transfers, uint32_t num)
{
	contributed_transfers += num;
	Transfer_t *end = transfers + num;
	for (Transfer_t *transfer = transfers ; transfer < end; transfer++) {
		free_Transfer(transfer);
	}
}

void USBHost::contribute_String_Buffers(strbuf_t *strbufs, uint32_t num)
{
	contributed_strings += num;
	strbuf_t *end = strbufs + num;
	for (strbuf_t *str = strbufs ; str < end; str++) {
		free_string_buffer(str);
	}
}

// for debugging, hopefully never needed...
void USBHost::countFree(uint32_t &devices, uint32_t &pipes, uint32_t &transfers, uint32_t &strs)
{
	const bool irq_was_enabled = __irq_enabled();
	__disable_irq();
	auto count_nodes = [](const void *node, uint32_t limit, uint32_t alignment, DiagnosticError error) {
		uint32_t count = 0;
		while (node != nullptr) {
			const uintptr_t address = reinterpret_cast<uintptr_t>(node);
			if (address % alignment != 0 || count >= limit) {
				recordDiagnosticError(error, nullptr, static_cast<uint32_t>(address));
				return UINT32_MAX;
			}
			const void *next;
			memcpy(&next, node, sizeof(next));
			node = next;
			++count;
		}
		return count;
	};
	devices = count_nodes(free_Device_list, contributed_devices, alignof(Device_t), DiagnosticError::DevicePoolCorruption);
	pipes = count_nodes(free_Pipe_list, contributed_pipes, alignof(Pipe_t), DiagnosticError::PipePoolCorruption);
	transfers = count_nodes(free_Transfer_list, contributed_transfers, alignof(Transfer_t), DiagnosticError::TransferPoolCorruption);
	strs = count_nodes(free_strbuf_list, contributed_strings, alignof(strbuf_t), DiagnosticError::StringPoolCorruption);
	if (irq_was_enabled) __enable_irq();
}
