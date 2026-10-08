#include <Arduino.h>
#include "USBHost_t36.h"

#if USBHOST_T36_ENABLE_DIAGNOSTICS
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
#endif
