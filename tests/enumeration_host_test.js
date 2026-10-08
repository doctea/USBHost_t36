const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function extractFunction(file, startMarker, endMarker) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const start = source.indexOf(startMarker);
    const end = endMarker ? source.indexOf(endMarker, start) : source.length;
    if (start < 0 || end < 0) throw new Error(`Cannot locate ${startMarker}`);
    return source.slice(start, end);
}

const rootPortAcknowledgement = extractFunction(
    'ehci.cpp',
    '\tif (stat & USBHS_USBSTS_PCI) { // port change detected',
    '\tif (stat & USBHS_USBSTS_TI0)',
).split('\n').find(line => line.trim().startsWith('USBHS_PORTSC1 ='));
if (!rootPortAcknowledgement) throw new Error('Cannot locate root-port acknowledgement');

const source = `
#include <cassert>
#include <cstdint>
#include <cstring>
#include <iostream>
#define HEX 16
#define ASSERT_DIAGNOSTIC(condition) do { if (USBHOST_T36_ENABLE_DIAGNOSTICS) assert(condition); } while (0)
struct Transfer_t;
struct Device_t;
struct strbuf_t;
struct setup_t {
    uint8_t bmRequestType = 0, bRequest = 0;
    uint16_t wValue = 0, wIndex = 0, wLength = 0;
    uint32_t word1 = 0, word2 = 0;
};
struct Pipe_t {
    struct {
        uintptr_t next = 1;
        uintptr_t horizontal_link = 1, current = 0;
        uint32_t token = 0, capabilities[2] = {};
    } qh;
    Device_t *device = nullptr;
    uint8_t type = 0;
    void (*callback_function)(const Transfer_t *) = nullptr;
    uint8_t direction = 0;
    Pipe_t *next = nullptr;
    Transfer_t *halt_transfer = nullptr;
    uint32_t diagnostic_submissions = 0;
    uint32_t diagnostic_completions = 0;
    uint32_t diagnostic_errors = 0;
    uint16_t bandwidth_interval = 1, bandwidth_offset = 0, bandwidth_shift = 0;
    uint8_t bandwidth_stime = 0, bandwidth_ctime = 0;
};
struct USBDriver {
    unsigned calls = 0;
    uint32_t last_token = 0;
    USBDriver *next = nullptr;
    Device_t *device = nullptr;
    unsigned disconnects = 0;
    void disconnect() { ++disconnects; }
    void control(const Transfer_t *);
};
struct Device_t {
    Pipe_t *control_pipe;
    Pipe_t *data_pipes;
    uint8_t enum_state, address, bDeviceClass, bDeviceSubClass, bDeviceProtocol;
    uint8_t bmAttributes, bMaxPower, speed, hub_address, hub_port;
    uint16_t idVendor, idProduct, LanguageID;
    strbuf_t *strbuf;
    USBDriver *drivers;
    Device_t *next;
};
struct Transfer_t {
    struct {
        uintptr_t next = 1, alt_next = 1;
        uint32_t token = 0, buffer[5] = {};
    } qtd;
    Transfer_t *next_followup = nullptr;
    Transfer_t *prev_followup = nullptr;
    Pipe_t *pipe = nullptr;
    USBDriver *driver = nullptr;
    void *buffer = nullptr;
    uint32_t length = 0;
    setup_t setup;
};
void USBDriver::control(const Transfer_t *transfer) {
    ++calls;
    last_token = transfer->qtd.token;
}
struct strbuf_t {
    strbuf_t *next = nullptr;
    enum { STR_ID_MAN, STR_ID_PROD, STR_ID_SERIAL };
    uint8_t iStrings[3] = {};
    char buffer[1] = {};
};
struct USBHost {
${extractFunction('USBHost_t36.h', '    enum class DiagnosticError', '    static void begin();')}
    #if USBHOST_T36_ENABLE_DIAGNOSTICS
    static void recordDiagnosticError(DiagnosticError, const Device_t * = nullptr, uint32_t = 0);
    #else
    static void recordDiagnosticError(DiagnosticError, const Device_t * = nullptr, uint32_t = 0) {}
    #endif
    static bool enumeration_busy;
    static bool system_error;
    static volatile HostFault host_fault;
    static volatile bool cleanup_stop_confirmed;
    static Device_t *new_Device(uint32_t, uint32_t, uint32_t);
    static Device_t *allocate_Device();
    static Pipe_t *allocate_Pipe();
    static Transfer_t *allocate_Transfer();
    static void free_Device(Device_t *);
    static void free_Pipe(Pipe_t *);
    static void free_Transfer(Transfer_t *);
    static void free_string_buffer(strbuf_t *);
    static void disconnect_Device(Device_t *);
    static void print_driverlist(const char *, USBDriver *) {}
    static void contribute_Pipes(Pipe_t *, uint32_t);
    static void contribute_Transfers(Transfer_t *, uint32_t);
    static void countFree(uint32_t &, uint32_t &, uint32_t &, uint32_t &);
    static strbuf_t *allocate_string_buffer();
    static Pipe_t *new_Pipe(Device_t *, uint32_t, uint32_t, uint32_t, uint32_t);
    static void enumeration(const Transfer_t *);
    static bool followup_Transfer(Transfer_t *);
    static bool queue_Transfer(Pipe_t *, Transfer_t *);
    static void followup_Error();
    static void followup_Error_list(bool);
    static void captureAsyncTransferDiagnostics(PipeDiagnosticInfo *, uint32_t);
    static void delete_Pipe(Pipe_t *);
    static bool stop_controller_for_cleanup(bool = true, HostFault = HostFault::None);
    static bool queue_Control_Transfer(Device_t *, setup_t *, void *, USBDriver *);
    static void print_device_descriptor(const uint8_t *) {}
    static void print_config_descriptor(const uint8_t *, uint32_t);
    static void print_string_descriptor(const char *, const uint8_t *);
    static void convertStringDescriptorToASCIIString(uint8_t, Device_t *, const Transfer_t *);
    static void claim_drivers(Device_t *);
    template<typename... Args> static void print_(Args...) {}
    template<typename... Args> static void println_(Args...) {}
};
bool USBHost::enumeration_busy = true;
bool USBHost::system_error = false;
volatile USBHost::HostFault USBHost::host_fault = USBHost::HostFault::None;
volatile bool USBHost::cleanup_stop_confirmed = false;
static uint32_t irq_state = 0;
static unsigned irq_disables = 0;
static int __irq_enabled() { return irq_state == 0; }
static void __disable_irq() { irq_state = 1; ++irq_disables; }
static void __enable_irq() { irq_state = 0; }
static uint32_t millis() { return 1234; }
#define __IMXRT1062__
#define DMAMEM
static unsigned cache_flushes = 0;
static void arm_dcache_flush(void *address, uint32_t length) {
    assert(reinterpret_cast<uintptr_t>(address) % 32 == 0);
    assert(length > 0 && irq_state == 1);
    ++cache_flushes;
}
${extractFunction('diagnostics.cpp', '#if USBHOST_T36_ENABLE_DIAGNOSTICS')}
#undef __IMXRT1062__
static uint8_t enumbuf[2048];
static setup_t enumsetup, last_request;
static uint16_t enumlen;
static Device_t device;
static Device_t *devlist = nullptr;
static USBDriver *available_drivers = nullptr;
${extractFunction('memory.cpp', '// Lists of "free" memory', '// A small amount of non-driver memory')}
static Pipe_t pipe;
static bool queue_ok = true;
static unsigned queues, config_prints, string_prints, conversions, claims, tests;
static const uint8_t config[] = {
    9,2,25,0,1,1,0,128,50,9,4,0,0,1,1,3,0,0,7,5,0x81,2,64,0,1
};
static void mk_setup(setup_t &setup, uint8_t type, uint8_t request, uint16_t value, uint16_t index, uint16_t length) {
    setup.bmRequestType = type; setup.bRequest = request;
    setup.wValue = value; setup.wIndex = index; setup.wLength = length;
    setup.word1 = type | (uint32_t(request) << 8) | (uint32_t(value) << 16);
    setup.word2 = index | (uint32_t(length) << 16);
}
static void pipe_set_maxlen(Pipe_t *, uint32_t) {}
static void pipe_set_addr(Pipe_t *, uint32_t) {}
static uint32_t assign_address() { return 1; }
${extractFunction('memory.cpp', 'Device_t * USBHost::allocate_Device(void)', 'void USBHost::free_Device(')}
${extractFunction('memory.cpp', 'void USBHost::free_Device(', 'Pipe_t * USBHost::allocate_Pipe(')}
${extractFunction('memory.cpp', 'Pipe_t * USBHost::allocate_Pipe(void)', 'void USBHost::free_Pipe(')}
${extractFunction('memory.cpp', 'void USBHost::free_Pipe(', 'Transfer_t * USBHost::allocate_Transfer(')}
${extractFunction('memory.cpp', 'Transfer_t * USBHost::allocate_Transfer(void)', 'void USBHost::free_Transfer(')}
${extractFunction('memory.cpp', 'void USBHost::free_Transfer(', 'strbuf_t * USBHost::allocate_string_buffer(')}
${extractFunction('memory.cpp', 'strbuf_t * USBHost::allocate_string_buffer(', 'void USBHost::contribute_Devices(')}
${extractFunction('memory.cpp', 'void USBHost::contribute_Pipes(', 'void USBHost::contribute_Transfers(')}
${extractFunction('memory.cpp', 'void USBHost::contribute_Transfers(', 'void USBHost::contribute_String_Buffers(')}
${extractFunction('memory.cpp', 'void USBHost::countFree(')}
Pipe_t *USBHost::new_Pipe(Device_t *owner, uint32_t, uint32_t, uint32_t, uint32_t) {
    pipe.device = owner; return &pipe;
}
bool USBHost::queue_Control_Transfer(Device_t *, setup_t *setup, void *, USBDriver *) {
    last_request = *setup; ++queues; return queue_ok;
}
void USBHost::print_config_descriptor(const uint8_t *, uint32_t length) {
    assert(length == enumlen); ++config_prints;
}
void USBHost::print_string_descriptor(const char *, const uint8_t *) { ++string_prints; }
void USBHost::convertStringDescriptorToASCIIString(uint8_t, Device_t *, const Transfer_t *) { ++conversions; }
void USBHost::claim_drivers(Device_t *) { ++claims; }
#define print USBHost::print_
#define println USBHost::println_
struct HubControlProbe : USBHost {
    enum { MAXPORTS = 7 };
    struct PortDiagnosticInfo {
        uint32_t status;
        uint16_t vid, pid;
        uint8_t state, address, enumeration_state;
        bool has_device;
    };
    struct HubDiagnosticInfo {
        uint32_t change_bits;
        uint8_t port_count, reset_port;
        bool change_pipe_present;
        PortDiagnosticInfo ports[MAXPORTS];
    };
    Device_t *device = nullptr;
    setup_t setup;
    uint8_t numports = 7, sending_control_transfer = 0;
    uint32_t statusbits = 0;
    uint32_t changebits = 0;
    uint8_t port_doing_reset = 0;
    Pipe_t *changepipe = nullptr;
    Device_t *devicelist[MAXPORTS] = {};
    uint8_t portstate[MAXPORTS] = {};
    uint32_t port_status[MAXPORTS] = {};
    #if USBHOST_T36_ENABLE_DIAGNOSTICS
    HubDiagnosticInfo getPortDiagnostics() const;
    #else
    HubDiagnosticInfo getPortDiagnostics() const { return {}; }
    #endif
    uint8_t send_pending_poweron = 0, send_pending_getstatus = 0;
    uint8_t send_pending_clearstatus_connect = 0, send_pending_clearstatus_enable = 0;
    uint8_t send_pending_clearstatus_suspend = 0, send_pending_clearstatus_overcurrent = 0;
    uint8_t send_pending_clearstatus_reset = 0, send_pending_setreset = 0;
    bool can_send_control_now();
    bool queue_port_control(void *);
    void Task();
    void send_poweron(uint32_t);
    void send_getstatus(uint32_t);
    void send_clearstatus_connect(uint32_t);
    void send_clearstatus_enable(uint32_t);
    void send_clearstatus_suspend(uint32_t);
    void send_clearstatus_overcurrent(uint32_t);
    void send_clearstatus_reset(uint32_t);
    void send_setreset(uint32_t);
    static bool queue_Control_Transfer(Device_t *, setup_t *request, void *, HubControlProbe *) {
        last_request = *request; ++queues; return queue_ok;
    }
};
${extractFunction('hub.cpp', 'bool USBHub::can_send_control_now()', '\nvoid USBHub::send_setinterface()').replace(/USBHub::/g, 'HubControlProbe::')}
${extractFunction('hub.cpp', '#if USBHOST_T36_ENABLE_DIAGNOSTICS\nUSBHub::HubDiagnosticInfo USBHub::getPortDiagnostics() const', '\nbool USBHub::claim(').replace(/USBHub::/g, 'HubControlProbe::')}
${extractFunction('hub.cpp', 'static uint32_t lowestbit(', '\nvoid USBHub::control(').replace(/USBHub::/g, 'HubControlProbe::')}
static Transfer_t *async_followup_first = nullptr, *async_followup_last = nullptr;
static Transfer_t *periodic_followup_first = nullptr, *periodic_followup_last = nullptr;
static Pipe_t *async_pipe_head = nullptr;
${extractFunction('ehci.cpp', 'static void add_to_async_followup_list(Transfer_t *first, Transfer_t *last)\n{', '\nstatic void remove_from_async_followup_list')}
${extractFunction('ehci.cpp', 'static void remove_from_async_followup_list(Transfer_t *transfer)\n{', '\nstatic void add_to_periodic_followup_list')}
${extractFunction('ehci.cpp', 'static void add_to_periodic_followup_list(Transfer_t *first, Transfer_t *last)\n{', '\nstatic void remove_from_periodic_followup_list')}
${extractFunction('ehci.cpp', 'static void remove_from_periodic_followup_list(Transfer_t *transfer)\n{', '\nstatic uint32_t max4(')}
${extractFunction('ehci.cpp', 'bool USBHost::queue_Transfer(Pipe_t *pipe, Transfer_t *transfer)', '\nbool USBHost::followup_Transfer(').replace(/\(uint32_t\)/g, '(uintptr_t)')}
${extractFunction('enumeration.cpp', 'Device_t * USBHost::new_Device(', '\n\n// Control transfer callback function.')}
${extractFunction('enumeration.cpp', 'void USBHost::enumeration(const Transfer_t *transfer)', '\nvoid  USBHost::convertStringDescriptorToASCIIString')}
${extractFunction('ehci.cpp', 'bool USBHost::followup_Transfer(Transfer_t *transfer)', '\nvoid USBHost::followup_Error(void)')}
${extractFunction('ehci.cpp', '#ifndef USBHOST_T36_QTD_CERR', '\n\n\n// Create a Control Transfer').replace('(uint32_t)buf', '(uint32_t)(uintptr_t)buf')}
${extractFunction('ehci.cpp', 'void USBHost::followup_Error(void)', '\nstatic void add_to_async_followup_list(Transfer_t *first, Transfer_t *last)\n{').replace(/\(uint32_t\)/g, '(uintptr_t)')}
constexpr uint32_t USBHS_USBCMD_ASE = 1, USBHS_USBCMD_IAA = 2;
constexpr uint32_t USBHS_USBSTS_AS = 4, USBHS_USBSTS_AAI = 8;
constexpr uint32_t USBHS_USBCMD_RS = 16, USBHS_USBCMD_PSE = 32, USBHS_USBSTS_HCH = 64;
static uint32_t USBHS_USBCMD = 0, USBHS_USBSTS = 0;
static uintptr_t USBHS_ASYNCLISTADDR = 0;
static uint32_t USBHS_USBINTR = 0, USBHS_FRINDEX = 0, USBHS_PORTSC1 = 0;
${extractFunction('ehci.cpp', '#if USBHOST_T36_ENABLE_DIAGNOSTICS\nUSBHost::ControllerDiagnosticInfo', '// Busy-waits use the cycle counter:')}
${extractFunction('enumeration.cpp', '#if USBHOST_T36_ENABLE_DIAGNOSTICS\nuint32_t USBHost::getAsyncPipeDiagnostics(', '\n// Drivers call this after')}
static void insert_async_pipe_probe(Pipe_t *pipe) {
${extractFunction('ehci.cpp', '\t\t// control or bulk: add to async queue', '\t} else if (type == 3)').replace(/\(uint32_t\)/g, '(uintptr_t)')}
}
constexpr uint32_t PERIODIC_LIST_SIZE = 8;
static uintptr_t periodictable[PERIODIC_LIST_SIZE];
static uint8_t uframe_bandwidth[PERIODIC_LIST_SIZE * 8] = {};
static bool schedule_wait_ok = true;
static bool periodic_clock_running = true;
static bool controller_stop_ok = true, controller_start_ok = true;
static unsigned periodic_wait_calls = 0, periodic_wait_fail_on_call = 0;
static Pipe_t *restart_cleanup_probe = nullptr;
static bool wait_usbsts(uint32_t mask, uint32_t want, uint32_t) {
    if (mask == USBHS_USBSTS_HCH && !want && restart_cleanup_probe) {
        assert(restart_cleanup_probe->halt_transfer == nullptr);
        assert(free_Transfer_list != nullptr && free_Pipe_list == nullptr);
    }
    if (mask == USBHS_USBSTS_HCH) return want ? controller_stop_ok : controller_start_ok;
    return schedule_wait_ok;
}
static bool wait_periodic_frame() {
    ++periodic_wait_calls;
    return schedule_wait_ok && periodic_clock_running && periodic_wait_calls != periodic_wait_fail_on_call;
}
${extractFunction('ehci.cpp', 'const char *USBHost::getHostFaultReason()', '\nvoid USBHost::delete_Pipe(')}
${extractFunction('ehci.cpp', 'void USBHost::delete_Pipe(Pipe_t *pipe)').replace(/\(uint32_t\)/g, '(uintptr_t)').replace(/0xFFFFFFE0/g, '~uintptr_t(31)').replace('uint32_t num = periodictable[i];', 'uintptr_t num = periodictable[i];')}
${extractFunction('enumeration.cpp', 'void USBHost::disconnect_Device(Device_t *dev)').replace(/\(uint32_t\)/g, '(uintptr_t)')}
static Transfer_t *retry_transfer = nullptr;
static unsigned retry_callbacks = 0;
static void retry_halted_transfer(const Transfer_t *transfer) {
    ++retry_callbacks;
    if (retry_callbacks == 1) {
        retry_transfer->qtd.token = 0x8080;
        assert(USBHost::queue_Transfer(transfer->pipe, retry_transfer));
    }
}
static void reset(uint8_t state) {
    USBHost::clearDiagnosticInfo();
    USBHost::system_error = false;
    USBHost::host_fault = USBHost::HostFault::None;
    USBHost::cleanup_stop_confirmed = false;
    device = Device_t{}; pipe = Pipe_t{}; devlist = nullptr;
    device.control_pipe = &pipe; device.enum_state = state;
    pipe.device = &device; pipe.callback_function = &USBHost::enumeration;
    std::memset(enumbuf, 0, sizeof(enumbuf)); enumsetup = setup_t{}; enumlen = 25;
    USBHost::enumeration_busy = true; queue_ok = true;
    queues = config_prints = string_prints = conversions = claims = 0;
}
static void respond(uint32_t received, uint32_t token = 0) {
    Transfer_t transfer;
    transfer.pipe = &pipe;
    transfer.buffer = enumbuf + ((device.enum_state >= 4 && device.enum_state <= 10) ? 4 : 0);
    transfer.length = received; transfer.qtd.token = token;
    USBHost::enumeration(&transfer); ++tests;
}
static void failed() {
    assert(device.enum_state == 15 && !USBHost::enumeration_busy);
    assert(config_prints == 0 && claims == 0);
    ASSERT_DIAGNOSTIC(USBHost::getDiagnosticInfo().count > 0);
}
static void config_response(uint32_t received) {
    Transfer_t status;
    status.pipe = &pipe; status.length = enumlen; status.qtd.token = 0x8000;
    Transfer_t data;
    data.next_followup = &status; data.qtd.token = 0x100 | ((enumlen - received) << 16);
    assert(USBHost::followup_Transfer(&data)); assert(status.length == received);
    assert(USBHost::followup_Transfer(&status)); ++tests;
}
static void test_root_port_acknowledgement() {
    constexpr uint32_t USBHS_PORTSC_CSC = 1u << 1;
    constexpr uint32_t USBHS_PORTSC_PEC = 1u << 3;
    constexpr uint32_t USBHS_PORTSC_OCC = 1u << 5;
    constexpr uint32_t change_mask = USBHS_PORTSC_CSC | USBHS_PORTSC_PEC | USBHS_PORTSC_OCC;
    struct ChangeRegister {
        uint32_t hardware = 0;
        ChangeRegister &operator=(uint32_t written) {
            hardware &= ~(written & change_mask);
            return *this;
        }
    } USBHS_PORTSC1;
    for (uint32_t observed : {0u, USBHS_PORTSC_CSC, USBHS_PORTSC_PEC, USBHS_PORTSC_OCC, change_mask}) {
        for (uint32_t late : {0u, USBHS_PORTSC_CSC, USBHS_PORTSC_PEC, USBHS_PORTSC_OCC}) {
            const uint32_t portstat = observed;
            USBHS_PORTSC1.hardware = observed | late;
            ${rootPortAcknowledgement}
            assert(USBHS_PORTSC1.hardware == (late & ~observed)); ++tests;
        }
    }
}
static void test_hub_port_diagnostic_snapshot() {
    #if USBHOST_T36_ENABLE_DIAGNOSTICS
    HubControlProbe hub;
    Device_t child = {};
    child.idVendor = 0x2e8a; child.idProduct = 0x10c1;
    child.address = 6; child.enum_state = 15;
    hub.numports = 2; hub.changebits = 2; hub.port_doing_reset = 1;
    hub.changepipe = &pipe; hub.devicelist[0] = &child;
    hub.portstate[0] = 9; hub.portstate[1] = 2;
    hub.port_status[0] = 0x103; hub.port_status[1] = 0x101;
    irq_state = 0;
    const auto enabled = hub.getPortDiagnostics();
    assert(enabled.port_count == 2 && enabled.change_bits == 2 && enabled.reset_port == 1);
    assert(enabled.change_pipe_present && enabled.ports[0].status == 0x103 && enabled.ports[0].state == 9);
    assert(enabled.ports[0].has_device && enabled.ports[0].vid == 0x2e8a && enabled.ports[0].pid == 0x10c1);
    assert(enabled.ports[0].address == 6 && enabled.ports[0].enumeration_state == 15);
    assert(!enabled.ports[1].has_device && enabled.ports[1].status == 0x101 && enabled.ports[1].state == 2);
    assert(irq_state == 0);
    irq_state = 1;
    hub.getPortDiagnostics();
    assert(irq_state == 1); ++tests;
    #else
    HubControlProbe hub;
    assert(hub.getPortDiagnostics().port_count == 0); ++tests;
    #endif
}
int main() {
    #if !USBHOST_T36_ENABLE_DIAGNOSTICS
    (void)&millis;
    (void)&arm_dcache_flush;
    (void)USBHS_FRINDEX;
    (void)USBHS_PORTSC1;
    #endif
    test_hub_port_diagnostic_snapshot();
    alignas(4096) uint8_t token_buffer[64] = {};
    Transfer_t token_probe;
    init_qTD(&token_probe, token_buffer, 64, 1, 1, true);
    const uint32_t cerr_bits = USBHOST_T36_QTD_CERR << 10;
    const uint32_t in_token = 0x80000000u | (64u << 16) | 0x8000u | 0x100u | 0x80u | cerr_bits;
    assert(token_probe.qtd.token == in_token && (token_probe.qtd.token & 0xC00u) == cerr_bits);
    assert(token_probe.qtd.alt_next == 1 && token_probe.qtd.buffer[0] == static_cast<uint32_t>(reinterpret_cast<uintptr_t>(token_buffer)));
    assert(token_probe.qtd.buffer[1] == token_probe.qtd.buffer[0] + 0x1000u); ++tests;
    init_qTD(&token_probe, token_buffer, 8, 2, 0, false);
    assert(token_probe.qtd.token == ((8u << 16) | 0x280u | cerr_bits) && (token_probe.qtd.token & 0xC00u) == cerr_bits); ++tests;
    init_qTD(&token_probe, token_buffer, 16, 0, 0, true);
    assert(token_probe.qtd.token == ((16u << 16) | 0x8080u | cerr_bits)); ++tests;
    for (auto request : {&HubControlProbe::send_poweron, &HubControlProbe::send_getstatus,
                         &HubControlProbe::send_clearstatus_connect, &HubControlProbe::send_clearstatus_enable,
                         &HubControlProbe::send_clearstatus_suspend, &HubControlProbe::send_clearstatus_overcurrent,
                         &HubControlProbe::send_clearstatus_reset, &HubControlProbe::send_setreset}) {
        for (uint32_t initial_irq : {0u, 1u}) {
            irq_state = initial_irq;
            USBHost::clearDiagnosticInfo();
            HubControlProbe hub;
            Device_t hub_device = {};
            hub_device.idVendor = 0x05e3;
            hub_device.idProduct = 0x0610;
            hub_device.address = 2;
            hub.device = &hub_device;
            const auto pending = [&hub]() {
                return hub.send_pending_poweron | hub.send_pending_getstatus | hub.send_pending_clearstatus_connect |
                       hub.send_pending_clearstatus_enable | hub.send_pending_clearstatus_suspend |
                       hub.send_pending_clearstatus_overcurrent | hub.send_pending_clearstatus_reset | hub.send_pending_setreset;
            };
            const auto before = queues;
            (hub.*request)(99);
            assert(queues == before && pending() == 0);
            hub.sending_control_transfer = 1;
            (hub.*request)(3);
            hub.Task();
            assert(queues == before && pending() == 8 && irq_state == initial_irq);
            hub.sending_control_transfer = 0;
            queue_ok = false;
            hub.Task();
            assert(hub.sending_control_transfer == 0 && pending() == 8 && irq_state == initial_irq);
            const auto rejected = USBHost::getDiagnosticInfo();
            ASSERT_DIAGNOSTIC(rejected.count == 1 && rejected.error == USBHost::DiagnosticError::ControlQueue);
            ASSERT_DIAGNOSTIC(rejected.detail == last_request.word1 && rejected.vid == 0x05e3 && rejected.pid == 0x0610);
            ASSERT_DIAGNOSTIC(rejected.address == 2);
            assert(last_request.wIndex == 3);
            hub.Task();
            assert(hub.sending_control_transfer == 0 && pending() == 8 && irq_state == initial_irq);
            ASSERT_DIAGNOSTIC(USBHost::getDiagnosticInfo().count == 2);
            queue_ok = true;
            hub.Task();
            assert(hub.sending_control_transfer == 1 && pending() == 0 && irq_state == initial_irq);
            const auto accepted = queues;
            hub.Task();
            hub.sending_control_transfer = 0;
            hub.Task();
            assert(queues == accepted && irq_state == initial_irq); ++tests;
        }
    }
    for (uint8_t pipe_type : {uint8_t(0), uint8_t(2), uint8_t(3)}) {
        Pipe_t halted_pipe;
        halted_pipe.type = pipe_type;
        Transfer_t failed_transfer, dummy, incoming;
        failed_transfer.qtd.token = 0x40;
        failed_transfer.qtd.next = reinterpret_cast<uintptr_t>(&dummy);
        failed_transfer.pipe = &halted_pipe;
        dummy.qtd.token = 0x40;
        halted_pipe.qh.next = reinterpret_cast<uintptr_t>(&failed_transfer);
        halted_pipe.halt_transfer = &dummy;
        incoming.qtd.token = 0x8080;
        incoming.pipe = &halted_pipe;
        async_followup_first = async_followup_last = nullptr;
        periodic_followup_first = periodic_followup_last = nullptr;
        irq_state = 0;
        assert(USBHost::queue_Transfer(&halted_pipe, &incoming));
        assert(failed_transfer.qtd.token == 0x40);
        assert(failed_transfer.qtd.next == reinterpret_cast<uintptr_t>(&dummy));
        assert(dummy.qtd.token == 0x8080 && dummy.pipe == &halted_pipe);
        assert(dummy.qtd.next == reinterpret_cast<uintptr_t>(&incoming));
        assert(incoming.qtd.token == 0x40 && incoming.qtd.next == 1);
        assert(halted_pipe.halt_transfer == &incoming);
        assert(halted_pipe.diagnostic_submissions == USBHOST_T36_ENABLE_DIAGNOSTICS);
        assert((pipe_type == 3 ? periodic_followup_first : async_followup_first) == &dummy);
        assert(irq_state == 0); ++tests;
    }
    for (uint8_t pipe_type : {uint8_t(0), uint8_t(2), uint8_t(3)}) {
        Pipe_t grouped_pipe;
        grouped_pipe.type = pipe_type;
        Transfer_t dummy, incoming, middle, last;
        dummy.qtd.token = 0x40;
        grouped_pipe.halt_transfer = &dummy;
        grouped_pipe.qh.next = reinterpret_cast<uintptr_t>(&dummy);
        incoming.qtd.token = 0x80;
        incoming.qtd.next = reinterpret_cast<uintptr_t>(&middle);
        middle.qtd.next = reinterpret_cast<uintptr_t>(&last);
        last.qtd.token = 0x8080;
        last.pipe = &grouped_pipe;
        async_followup_first = async_followup_last = nullptr;
        periodic_followup_first = periodic_followup_last = nullptr;
        irq_state = 1;
        assert(USBHost::queue_Transfer(&grouped_pipe, &incoming));
        assert(dummy.pipe == &grouped_pipe && middle.pipe == &grouped_pipe && last.pipe == &grouped_pipe);
        assert(dummy.next_followup == &middle && middle.next_followup == &last);
        assert(last.next_followup == nullptr && grouped_pipe.halt_transfer == &incoming);
        assert(irq_state == 1); ++tests;
    }
    for (uint8_t pipe_type : {uint8_t(0), uint8_t(2), uint8_t(3)}) for (uint32_t initial_irq : {0u, 1u}) {
        Pipe_t halted_pipe;
        halted_pipe.type = pipe_type;
        halted_pipe.callback_function = retry_halted_transfer;
        Device_t failing_device = {};
        failing_device.idVendor = 0x2e8a;
        failing_device.idProduct = 0x10c1;
        failing_device.address = 6;
        failing_device.hub_address = 2;
        failing_device.hub_port = 3;
        halted_pipe.device = &failing_device;
        alignas(32) Transfer_t failed, dummy, incoming;
        failed.qtd.token = 0x8040;
        failed.qtd.next = reinterpret_cast<uintptr_t>(&dummy);
        failed.pipe = &halted_pipe;
        dummy.qtd.token = 0x40;
        halted_pipe.qh.next = reinterpret_cast<uintptr_t>(&failed);
        halted_pipe.halt_transfer = &dummy;
        halted_pipe.qh.token = 0x40;
        retry_transfer = &incoming;
        retry_callbacks = 0;
        async_followup_first = async_followup_last = nullptr;
        periodic_followup_first = periodic_followup_last = nullptr;
        if (pipe_type != 3) add_to_async_followup_list(&failed, &failed);
        else add_to_periodic_followup_list(&failed, &failed);
        free_Transfer_list = nullptr;
        contributed_transfers = 3;
        irq_state = initial_irq;
        USBHost::clearDiagnosticInfo();
        USBHost::followup_Error_list(pipe_type == 3);
        assert(halted_pipe.qh.next == reinterpret_cast<uintptr_t>(&dummy));
        assert(halted_pipe.halt_transfer == &incoming && halted_pipe.qh.token == 0);
        assert(retry_callbacks == 1 && irq_state == initial_irq);
        assert((pipe_type == 3 ? periodic_followup_first : async_followup_first) == &dummy);
        assert(dummy.qtd.token == 0x8080 && dummy.next_followup == nullptr);
        auto halted_error = USBHost::getDiagnosticInfo();
         ASSERT_DIAGNOSTIC(halted_error.count == 1 && halted_error.error == USBHost::DiagnosticError::EndpointTransfer);
         assert(halted_pipe.diagnostic_errors == USBHOST_T36_ENABLE_DIAGNOSTICS &&
             halted_pipe.diagnostic_submissions == USBHOST_T36_ENABLE_DIAGNOSTICS);
         ASSERT_DIAGNOSTIC(halted_error.detail == 0x8040 && halted_error.vid == 0x2e8a && halted_error.pid == 0x10c1);
         ASSERT_DIAGNOSTIC(halted_error.address == 6 && halted_error.hub == 2 && halted_error.port == 3);
        assert(USBHost::allocate_Transfer() == &failed);
        assert(free_Transfer_list == nullptr); ++tests;
    }
    for (bool driver_owned : {false, true}) for (unsigned failed_stage : {0u, 1u, 2u}) for (uint32_t error_bits : {0x40u, 0x48u, 0x50u, 0x60u}) for (uint32_t initial_irq : {0u, 1u}) {
        reset(4);
        irq_state = initial_irq;
        USBDriver owner;
        alignas(32) Transfer_t chain[3], dummy;
        const uint32_t tokens[] = {0x200, 0x100, 0x8000};
        for (unsigned stage = 0; stage < 3; ++stage) {
            chain[stage].pipe = &pipe;
            chain[stage].qtd.token = tokens[stage] | (stage < failed_stage ? 0 : stage == failed_stage ? error_bits : 0x80);
            chain[stage].qtd.next = reinterpret_cast<uintptr_t>(stage < 2 ? &chain[stage + 1] : &dummy);
            chain[stage].next_followup = stage < 2 ? &chain[stage + 1] : nullptr;
            chain[stage].prev_followup = stage > 0 ? &chain[stage - 1] : nullptr;
        }
        chain[2].driver = driver_owned ? &owner : nullptr;
        chain[2].buffer = enumbuf;
        pipe.halt_transfer = &dummy;
        pipe.qh.next = reinterpret_cast<uintptr_t>(&chain[0]);
        pipe.qh.token = 0x40;
        free_Transfer_list = nullptr;
        contributed_transfers = 4;
        async_followup_first = async_followup_last = nullptr;
        add_to_async_followup_list(&chain[0], &chain[2]);
        USBHost::followup_Error_list(false);
        const auto result = USBHost::getDiagnosticInfo();
        if (driver_owned) {
            assert(owner.calls == 1);
            ASSERT_DIAGNOSTIC(result.count == 1);
            ASSERT_DIAGNOSTIC(result.error == USBHost::DiagnosticError::EndpointTransfer);
            ASSERT_DIAGNOSTIC(result.detail == (tokens[failed_stage] | error_bits));
            assert(owner.last_token == (tokens[2] | error_bits));
        } else {
            assert(owner.calls == 0 && result.count == 0);
        }
        assert(irq_state == initial_irq && async_followup_first == nullptr);
        assert(USBHost::allocate_Transfer() && USBHost::allocate_Transfer() && USBHost::allocate_Transfer());
        assert(free_Transfer_list == nullptr); ++tests;
    }
    for (uint8_t state : {1, 2}) for (unsigned failed_stage = 0; failed_stage < (state == 1 ? 2u : 3u); ++failed_stage) for (uint32_t initial_irq : {0u, 1u}) {
        reset(state);
        irq_state = initial_irq;
        device.address = state == 1 ? 0 : 6;
        device.hub_address = state == 1 ? 20 : 2;
        device.hub_port = 2;
        const unsigned stages = state == 1 ? 2 : 3;
        alignas(32) Transfer_t chain[3], dummy, survivor;
        Pipe_t survivor_pipe;
        survivor.pipe = &survivor_pipe;
        survivor.qtd.token = 0x80;
        const uint32_t tokens[] = {0x200, state == 1 ? 0x80008100u : 0x80120100u, 0x80008000};
        for (unsigned stage = 0; stage < stages; ++stage) {
            chain[stage].pipe = &pipe;
            chain[stage].qtd.token = tokens[stage] | (stage < failed_stage ? 0 : stage == failed_stage ? 0x40 : 0x80);
            chain[stage].next_followup = stage + 1 < stages ? &chain[stage + 1] : nullptr;
            chain[stage].prev_followup = stage > 0 ? &chain[stage - 1] : nullptr;
        }
        dummy.qtd.token = 0x40;
        pipe.halt_transfer = &dummy;
        pipe.qh.next = reinterpret_cast<uintptr_t>(&chain[failed_stage]);
        pipe.qh.token = 0x40;
        free_Transfer_list = nullptr;
        contributed_transfers = stages + 2;
        async_followup_first = async_followup_last = nullptr;
        add_to_async_followup_list(&chain[0], &chain[stages - 1]);
        add_to_async_followup_list(&survivor, &survivor);
        USBHost::followup_Error_list(false);
        failed();
        const auto result = USBHost::getDiagnosticInfo();
        ASSERT_DIAGNOSTIC(result.count == 1 && result.error == USBHost::DiagnosticError::EnumerationTransfer);
        ASSERT_DIAGNOSTIC(result.state == state && result.hub == device.hub_address && result.port == 2 && result.address == device.address);
        ASSERT_DIAGNOSTIC(result.detail == (tokens[stages - 1] | 0x40));
        assert(pipe.qh.next == reinterpret_cast<uintptr_t>(&dummy) && pipe.qh.token == 0);
        assert(async_followup_first == &survivor && async_followup_last == &survivor);
        assert(survivor.prev_followup == nullptr && survivor.next_followup == nullptr);
        for (unsigned stage = 0; stage < stages; ++stage) assert(USBHost::allocate_Transfer());
        assert(free_Transfer_list == nullptr && irq_state == initial_irq); ++tests;
    }
    for (uint8_t pipe_type : {uint8_t(0), uint8_t(2), uint8_t(3)}) for (uint32_t initial_irq : {0u, 1u}) for (bool stale_head : {false, true}) {
        alignas(32) Pipe_t dying_pipe, survivor;
        Device_t pipe_device = {};
        pipe_device.speed = 2;
        dying_pipe.device = &pipe_device;
        dying_pipe.type = pipe_type;
        Transfer_t pool[8];
        free_Transfer_list = nullptr;
        contributed_transfers = 0;
        free_Pipe_list = nullptr;
        contributed_pipes = 1;
        irq_state = initial_irq;
        USBHost::clearDiagnosticInfo();
        USBHost::contribute_Transfers(pool, 8);
        Transfer_t *dummy = USBHost::allocate_Transfer();
        Transfer_t *pending = USBHost::allocate_Transfer();
        Transfer_t *other_pending = USBHost::allocate_Transfer();
        Transfer_t *completed = USBHost::allocate_Transfer();
        *dummy = Transfer_t{}; *pending = Transfer_t{};
        *other_pending = Transfer_t{}; *completed = Transfer_t{};
        dummy->qtd.token = 0x40;
        pending->qtd.token = 0x80;
        pending->qtd.next = reinterpret_cast<uintptr_t>(dummy);
        pending->pipe = &dying_pipe;
        other_pending->pipe = &survivor;
        dying_pipe.halt_transfer = dummy;
        USBHost::free_Transfer(completed);
        dying_pipe.qh.next = reinterpret_cast<uintptr_t>(stale_head ? completed : pending);
        pending->next_followup = other_pending;
        other_pending->prev_followup = pending;
        async_followup_first = async_followup_last = nullptr;
        periodic_followup_first = periodic_followup_last = nullptr;
        for (auto &entry : periodictable) entry = 1;
        if (pipe_type != 3) {
            dying_pipe.qh.horizontal_link = reinterpret_cast<uintptr_t>(&survivor) | 2;
            survivor.qh.horizontal_link = reinterpret_cast<uintptr_t>(&dying_pipe) | 2;
            dying_pipe.qh.capabilities[0] = 0x8000;
            USBHS_ASYNCLISTADDR = reinterpret_cast<uintptr_t>(&dying_pipe);
            async_pipe_head = &dying_pipe;
            USBHS_USBSTS = USBHS_USBSTS_AS;
            add_to_async_followup_list(pending, other_pending);
        } else {
            periodictable[0] = reinterpret_cast<uintptr_t>(&dying_pipe) | 2;
            periodictable[1] = 0;
            add_to_periodic_followup_list(pending, other_pending);
        }
        USBHost::delete_Pipe(&dying_pipe);
        assert(USBHost::getDiagnosticInfo().count == 0 && irq_state == initial_irq);
        assert(dying_pipe.halt_transfer == nullptr);
        assert((pipe_type != 3 ? async_followup_first : periodic_followup_first) == other_pending);
        assert(other_pending->prev_followup == nullptr && other_pending->next_followup == nullptr);
        if (pipe_type != 3) {
            assert((survivor.qh.horizontal_link & ~uintptr_t(31)) == reinterpret_cast<uintptr_t>(&survivor));
            assert(survivor.qh.capabilities[0] & 0x8000);
            assert(async_pipe_head == &survivor);
            assert(USBHS_ASYNCLISTADDR == reinterpret_cast<uintptr_t>(&dying_pipe));
            alignas(32) Pipe_t replacement;
            replacement.type = pipe_type;
            insert_async_pipe_probe(&replacement);
            assert((survivor.qh.horizontal_link & ~uintptr_t(31)) == reinterpret_cast<uintptr_t>(&replacement));
            assert((replacement.qh.horizontal_link & ~uintptr_t(31)) == reinterpret_cast<uintptr_t>(&survivor));
        } else assert(periodictable[0] == 1 && periodictable[1] == 1);
        uint32_t devices, pipes, transfers, strings;
        USBHost::countFree(devices, pipes, transfers, strings);
        assert(transfers == 7 && pipes == 1); ++tests;
        free_Transfer_list = nullptr;
        free_Pipe_list = nullptr;
        contributed_pipes = 0;
    }
    for (uint8_t pipe_type : {uint8_t(0), uint8_t(2)}) for (uint32_t initial_irq : {0u, 1u}) {
        alignas(32) Pipe_t sole, replacement;
        alignas(32) Transfer_t dummy;
        sole.type = replacement.type = pipe_type;
        sole.qh.horizontal_link = reinterpret_cast<uintptr_t>(&sole) | 2;
        sole.qh.capabilities[0] = 0x8000;
        sole.halt_transfer = &dummy;
        dummy.qtd.token = 0x40;
        async_pipe_head = &sole;
        USBHS_ASYNCLISTADDR = reinterpret_cast<uintptr_t>(&sole);
        USBHS_USBCMD = USBHS_USBCMD_ASE;
        USBHS_USBSTS = USBHS_USBSTS_AS;
        async_followup_first = async_followup_last = nullptr;
        free_Pipe_list = nullptr;
        contributed_pipes = 1;
        free_Transfer_list = nullptr;
        contributed_transfers = 1;
        irq_state = initial_irq;
        USBHost::clearDiagnosticInfo();
        USBHost::delete_Pipe(&sole);
        assert(async_pipe_head == nullptr && USBHS_ASYNCLISTADDR == 0);
        assert(!(USBHS_USBCMD & USBHS_USBCMD_ASE) && irq_state == initial_irq);
        insert_async_pipe_probe(&replacement);
        assert(async_pipe_head == &replacement);
        assert(USBHS_ASYNCLISTADDR == reinterpret_cast<uintptr_t>(&replacement));
        assert(USBHS_USBCMD & USBHS_USBCMD_ASE);
        assert((replacement.qh.horizontal_link & ~uintptr_t(31)) == reinterpret_cast<uintptr_t>(&replacement));
        assert(replacement.qh.capabilities[0] & 0x8000);
        assert(USBHost::getDiagnosticInfo().count == 0);
        free_Pipe_list = nullptr;
        contributed_pipes = 0;
        free_Transfer_list = nullptr;
        async_pipe_head = nullptr;
        ++tests;
    }
    {
        alignas(32) Pipe_t dying, live_async, obsolete_async;
        alignas(32) Transfer_t halt;
        Device_t owner = {}; owner.speed = 2;
        dying.type = 3; dying.device = &owner; dying.halt_transfer = &halt;
        dying.qh.horizontal_link = 1;
        for (auto &entry : periodictable) entry = 1;
        periodictable[0] = reinterpret_cast<uintptr_t>(&dying) | 2;
        free_Pipe_list = nullptr; free_Transfer_list = nullptr;
        contributed_pipes = contributed_transfers = 1;
        USBHost::system_error = false;
        USBHost::host_fault = USBHost::HostFault::None;
        live_async.qh.horizontal_link = reinterpret_cast<uintptr_t>(&live_async) | 2;
        async_pipe_head = &live_async;
        USBHS_ASYNCLISTADDR = reinterpret_cast<uintptr_t>(&obsolete_async);
        USBHS_USBCMD = USBHS_USBCMD_RS | USBHS_USBCMD_PSE | USBHS_USBCMD_ASE;
        USBHS_USBINTR = 0x1234;
        schedule_wait_ok = true; periodic_clock_running = false;
        controller_stop_ok = controller_start_ok = true;
        restart_cleanup_probe = &dying;
        periodic_wait_calls = 0; periodic_wait_fail_on_call = 1;
        USBHost::delete_Pipe(&dying);
        assert(!USBHost::system_error && periodic_wait_calls == 1);
        assert(std::strcmp(USBHost::getHostFaultReason(), "none") == 0);
        assert(USBHS_USBCMD == (USBHS_USBCMD_RS | USBHS_USBCMD_PSE | USBHS_USBCMD_ASE));
        assert(USBHS_ASYNCLISTADDR == reinterpret_cast<uintptr_t>(&live_async));
        assert(USBHS_USBINTR == 0x1234 && periodictable[0] == 1);
        assert(free_Pipe_list == &dying && free_Transfer_list == &halt); ++tests;

        for (bool stop_ok : {false, true}) {
            dying = Pipe_t{}; dying.type = 3; dying.device = &owner; dying.halt_transfer = &halt;
            dying.qh.horizontal_link = 1;
            for (auto &entry : periodictable) entry = 1;
            periodictable[0] = reinterpret_cast<uintptr_t>(&dying) | 2;
            free_Pipe_list = nullptr; free_Transfer_list = nullptr;
            USBHost::system_error = false;
            USBHS_USBCMD = USBHS_USBCMD_RS | USBHS_USBCMD_PSE;
            USBHS_USBINTR = 0x1234;
            controller_stop_ok = stop_ok; controller_start_ok = false;
            periodic_wait_calls = 0; periodic_wait_fail_on_call = 1;
            USBHost::delete_Pipe(&dying);
            assert(USBHost::system_error && free_Pipe_list == nullptr);
            assert(free_Transfer_list == (stop_ok ? &halt : nullptr));
            assert(USBHost::host_fault == (stop_ok ? USBHost::HostFault::PeriodicRestartTimeout : USBHost::HostFault::PeriodicStopTimeout));
            assert(USBHost::wasCleanupStopConfirmed() == stop_ok);
            assert(dying.halt_transfer == (stop_ok ? nullptr : &halt));
            assert(!USBHS_USBCMD && !USBHS_USBINTR); ++tests;
        }
        restart_cleanup_probe = nullptr;
        async_pipe_head = nullptr;
        schedule_wait_ok = true;
        periodic_clock_running = true;
        controller_stop_ok = controller_start_ok = true;
        periodic_wait_fail_on_call = 0;
    }
    for (uint32_t initial_irq : {0u, 1u}) {
        alignas(32) Pipe_t periodic, control;
        alignas(32) Transfer_t periodic_halt, periodic_pending, control_halt;
        Device_t owner = {};
        strbuf_t strings;
        USBDriver driver;
        owner.speed = 2; owner.enum_state = 15;
        owner.data_pipes = &periodic; owner.control_pipe = &control;
        owner.strbuf = &strings; owner.drivers = &driver;
        driver.device = &owner; devlist = &owner; available_drivers = nullptr;
        periodic.type = 3; periodic.device = &owner; periodic.halt_transfer = &periodic_halt;
        periodic.qh.horizontal_link = 1;
        periodic_pending.pipe = &periodic; periodic_pending.qtd.token = 0x80;
        periodic_followup_first = periodic_followup_last = &periodic_pending;
        control.type = 0; control.device = &owner; control.halt_transfer = &control_halt;
        control.qh.horizontal_link = reinterpret_cast<uintptr_t>(&control) | 2;
        async_followup_first = async_followup_last = nullptr;
        async_pipe_head = &control;
        USBHS_ASYNCLISTADDR = reinterpret_cast<uintptr_t>(&control);
        for (auto &entry : periodictable) entry = 1;
        periodictable[0] = reinterpret_cast<uintptr_t>(&periodic) | 2;
        free_Device_list = nullptr; free_Pipe_list = nullptr;
        free_Transfer_list = nullptr; free_strbuf_list = nullptr;
        contributed_devices = contributed_strings = 1;
        contributed_pipes = 2; contributed_transfers = 3;
        USBHost::system_error = false; USBHost::host_fault = USBHost::HostFault::None;
        USBHost::enumeration_busy = false; irq_state = initial_irq;
        USBHS_USBSTS = USBHS_USBSTS_AS;
        USBHS_USBCMD = USBHS_USBCMD_RS | USBHS_USBCMD_PSE | USBHS_USBCMD_ASE;
        USBHS_USBINTR = 0x1234;
        schedule_wait_ok = true; periodic_clock_running = false;
        controller_stop_ok = controller_start_ok = true;
        periodic_wait_calls = 0;
        restart_cleanup_probe = &periodic;
        USBHost::disconnect_Device(&owner);
        assert(!USBHost::system_error && devlist == nullptr && periodic_wait_calls == 1);
        assert(driver.device == nullptr && driver.disconnects == 1 && available_drivers == &driver);
        assert(periodic_followup_first == nullptr && periodic_followup_last == nullptr);
        assert(async_pipe_head == nullptr && USBHS_ASYNCLISTADDR == 0);
        assert(USBHS_USBCMD == (USBHS_USBCMD_RS | USBHS_USBCMD_PSE) && USBHS_USBINTR == 0x1234);
        uint32_t devices, pipes, transfers, strings_count;
        USBHost::countFree(devices, pipes, transfers, strings_count);
        assert(devices == 1 && pipes == 2 && transfers == 3 && strings_count == 1);
        queue_ok = true;
        const unsigned before_queues = queues;
        assert(USBHost::new_Device(2, 0, 0) == &owner);
        assert(devlist == &owner && owner.enum_state == 0 && USBHost::enumeration_busy);
        assert(queues == before_queues + 1 && last_request.bRequest == 6 && last_request.wLength == 8);
        assert(irq_state == initial_irq); ++tests;
        restart_cleanup_probe = nullptr; periodic_clock_running = true;
        devlist = nullptr; available_drivers = nullptr;
        free_Device_list = nullptr; free_Pipe_list = nullptr;
        free_Transfer_list = nullptr; free_strbuf_list = nullptr;
    }
    for (uint8_t pipe_type : {uint8_t(0), uint8_t(2)}) for (uint32_t initial_irq : {0u, 1u}) {
        alignas(32) Pipe_t sole;
        alignas(32) Transfer_t dummy, pending;
        sole.type = pipe_type;
        sole.qh.horizontal_link = reinterpret_cast<uintptr_t>(&sole) | 2;
        sole.halt_transfer = &dummy;
        pending.pipe = &sole;
        pending.qtd.token = 0x80;
        async_followup_first = async_followup_last = &pending;
        async_pipe_head = &sole;
        USBHS_USBCMD = USBHS_USBCMD_ASE;
        USBHS_USBSTS = USBHS_USBSTS_AS;
        free_Pipe_list = nullptr; free_Transfer_list = nullptr;
        contributed_pipes = 1; contributed_transfers = 2;
        schedule_wait_ok = false; USBHost::system_error = false; irq_state = initial_irq;
        USBHost::delete_Pipe(&sole);
        assert(free_Pipe_list == nullptr && free_Transfer_list == nullptr);
        assert(sole.halt_transfer == &dummy && async_followup_first == &pending);
        assert(std::strcmp(USBHost::getHostFaultReason(), "async-disable-timeout") == 0);
        assert(USBHost::system_error && irq_state == initial_irq); ++tests;
        schedule_wait_ok = true; USBHost::system_error = false;
        async_pipe_head = nullptr; async_followup_first = async_followup_last = nullptr;
    }
    for (uint8_t pipe_type : {uint8_t(0), uint8_t(2), uint8_t(3)}) for (uint32_t initial_irq : {0u, 1u}) {
        alignas(32) Pipe_t dying, survivor;
        alignas(32) Transfer_t dummy, pending;
        Device_t owner = {}; owner.speed = 2;
        dying.type = pipe_type; dying.device = &owner; dying.halt_transfer = &dummy;
        pending.pipe = &dying; pending.qtd.token = 0x80;
        dying.qh.horizontal_link = reinterpret_cast<uintptr_t>(&survivor) | 2;
        survivor.qh.horizontal_link = reinterpret_cast<uintptr_t>(&dying) | 2;
        async_followup_first = async_followup_last = nullptr;
        periodic_followup_first = periodic_followup_last = nullptr;
        if (pipe_type == 3) {
            for (auto &entry : periodictable) entry = 1;
            periodictable[0] = reinterpret_cast<uintptr_t>(&dying) | 2;
            dying.qh.horizontal_link = 1;
            periodic_followup_first = periodic_followup_last = &pending;
        } else async_followup_first = async_followup_last = &pending;
        USBHS_USBSTS = USBHS_USBSTS_AS; USBHS_USBCMD = USBHS_USBCMD_ASE | USBHS_USBCMD_PSE | USBHS_USBCMD_RS;
        USBHS_USBINTR = 0xFFFFFFFF;
        free_Pipe_list = nullptr; free_Transfer_list = nullptr;
        schedule_wait_ok = false; USBHost::system_error = false; irq_state = initial_irq;
        controller_stop_ok = pipe_type != 3;
        USBHost::delete_Pipe(&dying);
        assert(USBHost::system_error && !USBHS_USBINTR && !USBHS_USBCMD);
        assert(USBHost::host_fault == (pipe_type == 3 ? USBHost::HostFault::PeriodicStopTimeout : USBHost::HostFault::AsyncAdvanceTimeout));
        assert(USBHost::wasCleanupStopConfirmed() == (pipe_type != 3));
        assert(free_Pipe_list == nullptr && free_Transfer_list == nullptr && dying.halt_transfer == &dummy);
        assert((pipe_type == 3 ? periodic_followup_first : async_followup_first) == &pending);
        assert(!USBHost::queue_Transfer(&dying, &pending) && irq_state == initial_irq); ++tests;
        schedule_wait_ok = true; USBHost::system_error = false;
        controller_stop_ok = true;
    }
    for (uint8_t pipe_type : {uint8_t(0), uint8_t(2), uint8_t(3)}) for (bool cyclic : {false, true}) {
        alignas(32) Pipe_t dying, survivor;
        alignas(32) Transfer_t dummy;
        Device_t owner = {}; dying.device = &owner;
        dying.type = pipe_type; dying.halt_transfer = &dummy;
        dying.qh.horizontal_link = cyclic ? reinterpret_cast<uintptr_t>(&survivor) | 2 : 0;
        survivor.qh.horizontal_link = reinterpret_cast<uintptr_t>(&survivor) | 2;
        for (auto &entry : periodictable) entry = 1;
        if (pipe_type == 3) periodictable[0] = reinterpret_cast<uintptr_t>(&survivor) | (cyclic ? 2 : 0);
        free_Pipe_list = nullptr; free_Transfer_list = nullptr;
        USBHost::system_error = false;
        USBHost::delete_Pipe(&dying);
        assert(USBHost::system_error && free_Pipe_list == nullptr && free_Transfer_list == nullptr); ++tests;
        const auto expected = pipe_type == 3
            ? (cyclic ? USBHost::HostFault::PeriodicCycle : USBHost::HostFault::PeriodicLink)
            : (cyclic ? USBHost::HostFault::AsyncRing : USBHost::HostFault::AsyncLink);
        assert(USBHost::host_fault == expected);
        USBHost::system_error = false;
    }
    for (uint8_t pipe_type : {uint8_t(0), uint8_t(2)}) for (uint32_t initial_irq : {0u, 1u}) {
        alignas(32) Pipe_t dying;
        alignas(32) Transfer_t dummy;
        Device_t owner = {}; strbuf_t strings;
        USBDriver driver;
        dying.type = pipe_type; dying.device = &owner; dying.halt_transfer = &dummy;
        dying.qh.horizontal_link = reinterpret_cast<uintptr_t>(&dying) | 2;
        owner.control_pipe = pipe_type == 0 ? &dying : nullptr;
        owner.data_pipes = pipe_type == 2 ? &dying : nullptr;
        owner.drivers = &driver; owner.strbuf = &strings; devlist = &owner;
        driver.device = &owner; available_drivers = nullptr;
        free_Device_list = nullptr; free_Pipe_list = nullptr; free_Transfer_list = nullptr; free_strbuf_list = nullptr;
        USBHS_USBSTS = USBHS_USBSTS_AS; USBHS_USBCMD = USBHS_USBCMD_ASE;
        schedule_wait_ok = false; USBHost::system_error = false; irq_state = initial_irq;
        USBHost::disconnect_Device(&owner);
        assert(USBHost::system_error && devlist == &owner && owner.strbuf == &strings);
        assert(free_Device_list == nullptr && free_Pipe_list == nullptr && free_Transfer_list == nullptr && free_strbuf_list == nullptr);
        assert(owner.drivers == nullptr && driver.disconnects == 1 && driver.device == nullptr);
        USBHost::disconnect_Device(&owner);
        assert(driver.disconnects == 1 && irq_state == initial_irq); ++tests;
        schedule_wait_ok = true; USBHost::system_error = false; devlist = nullptr; available_drivers = nullptr;
    }
    async_followup_first = async_followup_last = nullptr;
    periodic_followup_first = periodic_followup_last = nullptr;
    async_pipe_head = nullptr;
    contributed_transfers = 0;
    irq_state = 0;
    async_followup_first = async_followup_last = nullptr;
    periodic_followup_first = periodic_followup_last = nullptr;
    #if USBHOST_T36_ENABLE_DIAGNOSTICS
    USBHost::beginDiagnosticProgress();
    assert(USBHost::getPreviousDiagnosticProgress().phase == USBHost::DiagnosticPhase::None); ++tests;
    usb_progress_record.magic = 0x12345678;
    USBHost::beginDiagnosticProgress();
    assert(USBHost::getPreviousDiagnosticProgress().phase == USBHost::DiagnosticPhase::None); ++tests;
    irq_state = 1;
    const unsigned before_phase = cache_flushes;
    USBHost::setDiagnosticPhase(USBHost::DiagnosticPhase::USBTask);
    assert(cache_flushes == before_phase + 1 && irq_state == 1);
    USBHost::beginDiagnosticProgress();
    auto progress = USBHost::getPreviousDiagnosticProgress();
    assert(progress.phase == USBHost::DiagnosticPhase::USBTask && progress.at_ms == 1234);
    assert(irq_state == 1); ++tests;
    irq_state = 0;
    USBHost::setDiagnosticPhase(USBHost::DiagnosticPhase::Loop);
    assert(irq_state == 0);
    assert(USBHost::getPreviousDiagnosticProgress().phase == USBHost::DiagnosticPhase::USBTask); ++tests;
    USBHost::setDiagnosticPhase(USBHost::DiagnosticPhase::RetentionTest);
    usb_previous_progress = {};
    USBHost::beginDiagnosticProgress();
    assert(USBHost::getPreviousDiagnosticProgress().phase == USBHost::DiagnosticPhase::RetentionTest);
    assert(std::strcmp(USBHost::diagnosticPhaseName(USBHost::DiagnosticPhase::RetentionTest), "Retention test") == 0); ++tests;
    assert(static_cast<uint8_t>(USBHost::DiagnosticPhase::RetentionTest) == 14);
    for (auto phase : {USBHost::DiagnosticPhase::SerialIO, USBHost::DiagnosticPhase::ClockUpdate,
                       USBHost::DiagnosticPhase::GateUpdate, USBHost::DiagnosticPhase::TapTempo,
                       USBHost::DiagnosticPhase::ViewerCommands, USBHost::DiagnosticPhase::CVClock,
                       USBHost::DiagnosticPhase::ClockTicks, USBHost::DiagnosticPhase::MenuTicks}) {
        USBHost::setDiagnosticPhase(phase);
        USBHost::beginDiagnosticProgress();
        assert(USBHost::getPreviousDiagnosticProgress().phase == phase);
        assert(std::strcmp(USBHost::diagnosticPhaseName(phase), "Unknown") != 0); ++tests;
    }
    usb_progress_record.info.phase = static_cast<USBHost::DiagnosticPhase>(255);
    USBHost::beginDiagnosticProgress();
    assert(USBHost::getPreviousDiagnosticProgress().phase == USBHost::DiagnosticPhase::None); ++tests;
    USBHost::clearDiagnosticInfo();
    assert(USBHost::getDiagnosticInfo().error == USBHost::DiagnosticError::None);
    usb_error_record.magic = 0x12345678;
    assert(USBHost::getDiagnosticInfo().count == 0); ++tests;
    reset(13); device.idVendor = 0x09E8; device.idProduct = 0x0028;
    device.address = 4; device.hub_address = 2; device.hub_port = 3;
    const unsigned before_capture = cache_flushes;
    USBHost::recordDiagnosticError(USBHost::DiagnosticError::EnumerationTransfer, &device, 0x40);
    assert(cache_flushes == before_capture + 1);
    auto diagnostic = USBHost::getDiagnosticInfo();
    assert(diagnostic.count == 1 && diagnostic.at_ms == 1234 && diagnostic.detail == 0x40);
    assert(diagnostic.vid == 0x09E8 && diagnostic.pid == 0x0028 && diagnostic.state == 13);
    assert(diagnostic.address == 4 && diagnostic.hub == 2 && diagnostic.port == 3);
    assert(!diagnostic.previous_boot && irq_state == 0); ++tests;
    usb_error_recorded_this_boot = false;
    assert(USBHost::getDiagnosticInfo().previous_boot); ++tests;
    irq_state = 1;
    USBHost::recordDiagnosticError(USBHost::DiagnosticError::SystemError, nullptr, 0x10);
    diagnostic = USBHost::getDiagnosticInfo();
    assert(irq_state == 1 && diagnostic.count == 2 && !diagnostic.previous_boot);
    assert(diagnostic.vid == 0 && diagnostic.hub == 0 && diagnostic.detail == 0x10);
    const unsigned before_clear = cache_flushes;
    USBHost::clearDiagnosticInfo();
    assert(cache_flushes == before_clear + 1);
    assert(irq_state == 1 && USBHost::getDiagnosticInfo().count == 0); ++tests;
    #else
    for (uint32_t initial_irq : {0u, 1u}) {
        irq_state = initial_irq;
        const unsigned before_stubs = irq_disables;
        USBHost::PipeDiagnosticInfo sample = {};
        sample.address = 123;
        USBHost::beginDiagnosticProgress();
        USBHost::setDiagnosticPhase(USBHost::DiagnosticPhase::USBTask);
        USBHost::recordDiagnosticError(USBHost::DiagnosticError::SystemError);
        USBHost::clearDiagnosticInfo();
        assert(USBHost::getDiagnosticInfo().count == 0);
        assert(USBHost::getPreviousDiagnosticProgress().phase == USBHost::DiagnosticPhase::None);
        assert(USBHost::getControllerDiagnosticInfo().command == 0);
        assert(USBHost::getAsyncPipeDiagnostics(&sample, 1) == 0 && sample.address == 123);
        assert(irq_state == initial_irq && irq_disables == before_stubs && cache_flushes == 0); ++tests;
    }
    #endif
    irq_state = 0;
    for (uint32_t initial_irq : {0u, 1u}) {
        Device_t pool_device = {};
        Pipe_t pool_pipe;
        Transfer_t pool_transfer;
        strbuf_t pool_string;
        irq_state = initial_irq;
        unsigned before_pool_update = irq_disables;
        USBHost::free_Device(&pool_device);
        assert(irq_disables == ++before_pool_update && irq_state == initial_irq);
        assert(USBHost::allocate_Device() == &pool_device);
        assert(irq_disables == ++before_pool_update && irq_state == initial_irq); ++tests;
        USBHost::free_Pipe(&pool_pipe);
        assert(irq_disables == ++before_pool_update && irq_state == initial_irq);
        assert(USBHost::allocate_Pipe() == &pool_pipe);
        assert(irq_disables == ++before_pool_update && irq_state == initial_irq); ++tests;
        USBHost::free_Transfer(&pool_transfer);
        assert(irq_disables == ++before_pool_update && irq_state == initial_irq);
        assert(USBHost::allocate_Transfer() == &pool_transfer);
        assert(irq_disables == ++before_pool_update && irq_state == initial_irq); ++tests;
        pool_string.iStrings[0] = pool_string.iStrings[1] = pool_string.iStrings[2] = 3;
        pool_string.buffer[0] = 'x';
        USBHost::free_string_buffer(&pool_string);
        assert(irq_disables == ++before_pool_update && irq_state == initial_irq);
        assert(USBHost::allocate_string_buffer() == &pool_string);
        assert(irq_disables == ++before_pool_update && irq_state == initial_irq);
        assert(pool_string.iStrings[0] == 0 && pool_string.iStrings[1] == 0 &&
               pool_string.iStrings[2] == 0 && pool_string.buffer[0] == 0); ++tests;
    }
    irq_state = 0;
    {
        uint32_t devices, pipes, transfers, strings;
        Pipe_t pool[3];
        USBHost::contribute_Pipes(pool, 3);
        USBHost::countFree(devices, pipes, transfers, strings);
        assert(devices == 0 && pipes == 3 && transfers == 0 && strings == 0);
        assert(irq_state == 0); ++tests;
        free_Pipe_list = reinterpret_cast<Pipe_t *>(uintptr_t(1));
        irq_state = 1;
        USBHost::countFree(devices, pipes, transfers, strings);
        assert(pipes == UINT32_MAX && irq_state == 1);
        ASSERT_DIAGNOSTIC(USBHost::getDiagnosticInfo().error == USBHost::DiagnosticError::PipePoolCorruption);
        ASSERT_DIAGNOSTIC(USBHost::getDiagnosticInfo().detail == 1); ++tests;
        irq_state = 0;
        free_Pipe_list = &pool[0];
        pool[0].qh.next = reinterpret_cast<uintptr_t>(&pool[0]);
        USBHost::countFree(devices, pipes, transfers, strings);
        assert(pipes == UINT32_MAX && irq_state == 0);
        ASSERT_DIAGNOSTIC(USBHost::getDiagnosticInfo().error == USBHost::DiagnosticError::PipePoolCorruption); ++tests;
        free_Pipe_list = nullptr;
    }
    for (uint32_t initial_irq : {0u, 1u}) {
        Transfer_t pool[3];
        free_Transfer_list = nullptr;
        contributed_transfers = 0;
        irq_state = initial_irq;
        USBHost::clearDiagnosticInfo();
        USBHost::contribute_Transfers(pool, 3);
        assert(free_Transfer_list == &pool[2] && contributed_transfers == 3);
        assert(USBHost::getDiagnosticInfo().count == 0 && irq_state == initial_irq); ++tests;
        USBHost::free_Transfer(&pool[1]);
        auto duplicate = USBHost::getDiagnosticInfo();
        ASSERT_DIAGNOSTIC(duplicate.error == USBHost::DiagnosticError::TransferDoubleFree && duplicate.detail != 0);
        ASSERT_DIAGNOSTIC(std::strcmp(USBHost::diagnosticErrorName(duplicate.error), "Transfer double free") == 0);
        assert(free_Transfer_list == &pool[2] && irq_state == initial_irq); ++tests;
        USBHost::free_Transfer(&pool[2]);
        ASSERT_DIAGNOSTIC(USBHost::getDiagnosticInfo().error == USBHost::DiagnosticError::TransferDoubleFree);
        ASSERT_DIAGNOSTIC(USBHost::getDiagnosticInfo().count == duplicate.count + 1);
        assert(irq_state == initial_irq); ++tests;
        assert(USBHost::allocate_Transfer() == &pool[2]);
        assert(USBHost::allocate_Transfer() == &pool[1]);
        assert(USBHost::allocate_Transfer() == &pool[0]);
        assert(free_Transfer_list == nullptr && irq_state == initial_irq); ++tests;
        USBHost::clearDiagnosticInfo();
        USBHost::free_Transfer(&pool[1]);
        assert(USBHost::getDiagnosticInfo().count == 0);
        assert(USBHost::allocate_Transfer() == &pool[1] && irq_state == initial_irq); ++tests;
        free_Transfer_list = reinterpret_cast<Transfer_t *>(uintptr_t(1));
        USBHost::free_Transfer(&pool[2]);
        ASSERT_DIAGNOSTIC(USBHost::getDiagnosticInfo().error == USBHost::DiagnosticError::TransferPoolCorruption);
        ASSERT_DIAGNOSTIC(USBHost::getDiagnosticInfo().detail == 1);
        assert(irq_state == initial_irq);
        assert(free_Transfer_list == reinterpret_cast<Transfer_t *>(uintptr_t(1))); ++tests;
        free_Transfer_list = &pool[0];
        Transfer_t *cycle = &pool[0];
        std::memcpy(static_cast<void *>(&pool[0]), &cycle, sizeof(cycle));
        USBHost::free_Transfer(&pool[2]);
        ASSERT_DIAGNOSTIC(USBHost::getDiagnosticInfo().error == USBHost::DiagnosticError::TransferPoolCorruption);
        assert(free_Transfer_list == &pool[0] && irq_state == initial_irq); ++tests;
        free_Transfer_list = nullptr;
    }
    irq_state = 0;
    assert(USBHost::allocate_Device() == nullptr);
    ASSERT_DIAGNOSTIC(USBHost::getDiagnosticInfo().error == USBHost::DiagnosticError::DevicePool); ++tests;
    assert(USBHost::allocate_Pipe() == nullptr);
    ASSERT_DIAGNOSTIC(USBHost::getDiagnosticInfo().error == USBHost::DiagnosticError::PipePool); ++tests;
    assert(USBHost::allocate_Transfer() == nullptr);
    ASSERT_DIAGNOSTIC(USBHost::getDiagnosticInfo().error == USBHost::DiagnosticError::TransferPool); ++tests;
    {
        constexpr uint32_t USBHS_USBSTS_SEI = 0x10;
        const uint32_t stat = USBHS_USBSTS_SEI;
        ${extractFunction('ehci.cpp', '\tif (stat & USBHS_USBSTS_SEI) {', '\t// errors first,')
            .replace('recordDiagnosticError(', 'USBHost::recordDiagnosticError(')
            .replace('DiagnosticError::', 'USBHost::DiagnosticError::')
            .replace('HostFault::', 'USBHost::HostFault::')
            .replace('host_fault =', 'USBHost::host_fault =')
            .replace('cleanup_stop_confirmed =', 'USBHost::cleanup_stop_confirmed =')
            .replace('system_error =', 'USBHost::system_error =')}
        assert(USBHost::system_error);
        assert(std::strcmp(USBHost::getHostFaultReason(), "hardware-system-error") == 0);
        assert(!USBHost::wasCleanupStopConfirmed());
        ASSERT_DIAGNOSTIC(USBHost::getDiagnosticInfo().error == USBHost::DiagnosticError::SystemError);
        ASSERT_DIAGNOSTIC(USBHost::getDiagnosticInfo().detail == stat); ++tests;
        assert(USBHost::new_Device(1, 0, 0) == nullptr && USBHost::system_error); ++tests;
    }
    reset(0); queue_ok = false;
    device.control_pipe = nullptr; free_Device_list = &device;
    assert(USBHost::new_Device(1, 0, 0) == &device); failed(); ++tests;
    reset(0); device.control_pipe = nullptr; free_Device_list = &device;
    assert(USBHost::new_Device(1, 0, 0) == &device);
    assert(device.enum_state == 0 && USBHost::enumeration_busy && last_request.wLength == 8); ++tests;
    for (uint8_t state : {0,2}) for (uint32_t received : {0u,1u,7u}) {
        reset(state); enumbuf[0] = 18; enumbuf[1] = 1; enumbuf[7] = 64;
        respond(received); failed(); assert(queues == 0);
    }
    reset(0); enumbuf[0] = 18; enumbuf[1] = 1; enumbuf[7] = 64;
    respond(8); assert(device.enum_state == 1 && last_request.bRequest == 5);
    reset(0); enumbuf[0] = 18; enumbuf[1] = 1; respond(8); failed();
    reset(2); enumbuf[0] = 18; enumbuf[1] = 1;
    respond(18); assert(device.enum_state == 12 && last_request.wLength == 9);
    for (uint32_t received : {0u,2u,8u}) {
        reset(12); std::memcpy(enumbuf, config, 9); respond(received); failed();
    }
    for (uint16_t total : {0u,1u,8u}) {
        reset(12); std::memcpy(enumbuf, config, 9); enumbuf[2] = total; respond(9); failed();
    }
    reset(12); std::memcpy(enumbuf, config, 9); enumbuf[1] = 3; respond(9); failed();
    reset(12); std::memcpy(enumbuf, config, 9);
    respond(9); assert(device.enum_state == 13 && last_request.wLength == 25);
    std::memcpy(enumbuf, config, sizeof(config)); config_response(25);
    assert(device.enum_state == 14 && config_prints == 1 && last_request.bRequest == 9);
    respond(0); assert(device.enum_state == 15 && !USBHost::enumeration_busy && claims == 1);
    for (uint32_t received : {0u,8u,9u,18u,24u}) {
        reset(13); std::memcpy(enumbuf, config, sizeof(config)); config_response(received);
        failed(); assert(queues == 0);
    }
    for (uint8_t length : {0,1,17,255}) {
        reset(13); std::memcpy(enumbuf, config, sizeof(config)); enumbuf[9] = length;
        config_response(25); failed();
    }
    reset(13); std::memcpy(enumbuf, config, sizeof(config)); enumbuf[18] = 6;
    config_response(25); failed();
    reset(13); std::memcpy(enumbuf, config, sizeof(config)); enumbuf[2] = 8;
    config_response(25); failed();
    for (uint8_t state : {4,6,8,10}) for (uint32_t received : {0u,1u,3u}) {
        reset(state); enumbuf[4] = 4; enumbuf[5] = 3; respond(received);
        assert(conversions == 0 && string_prints == 0 && device.enum_state == 12);
    }
    for (uint8_t state : {6,8,10}) {
        reset(state); enumbuf[4] = 4; enumbuf[5] = 3; respond(4);
        assert(conversions == 1 && string_prints == 1 && device.enum_state == 12);
    }
    reset(4); enumbuf[0] = 1; enumbuf[4] = 4; enumbuf[5] = 3; enumbuf[6] = 9; enumbuf[7] = 4;
    respond(4); assert(device.LanguageID == 0x409 && device.enum_state == 6);
    for (uint8_t state : {0,1,2,3,4,5,6,7,8,9,10,11,12,13}) {
        reset(state); queue_ok = false; uint32_t received = 0;
        if (state == 0 || state == 2) { enumbuf[0] = 18; enumbuf[1] = 1; enumbuf[7] = 64; received = 18; }
        if (state == 12 || state == 13) { std::memcpy(enumbuf, config, sizeof(config)); received = 25; }
        respond(received); assert(device.enum_state == 15 && !USBHost::enumeration_busy);
    }
    reset(13); respond(0, 0x40); failed();
    ASSERT_DIAGNOSTIC(USBHost::getDiagnosticInfo().error == USBHost::DiagnosticError::EnumerationTransfer);
    ASSERT_DIAGNOSTIC(USBHost::getDiagnosticInfo().state == 13 && USBHost::getDiagnosticInfo().detail == 0x40);
    reset(6); respond(0, 0x40); assert(device.enum_state == 12 && USBHost::enumeration_busy);
    assert(USBHost::getDiagnosticInfo().count == 0);
    reset(14); respond(0, 0x40); failed();
    reset(13); USBDriver driver; Transfer_t owned; owned.driver = &driver;
    USBHost::enumeration(&owned); assert(driver.calls == 1 && device.enum_state == 13);

    reset(13);
    Transfer_t status, data;
    status.pipe = &pipe; status.qtd.token = 0x8000;
    data.next_followup = &status;
    for (uint32_t remaining : {0u,1u,9u,25u,26u}) {
        status.length = 25; data.qtd.token = 0x100 | (remaining << 16);
        assert(USBHost::followup_Transfer(&data));
        assert(status.length == (remaining <= 25 ? 25 - remaining : 0)); ++tests;
    }
    status.length = 25; data.qtd.token = 0x80 | 0x100 | (9u << 16);
    assert(!USBHost::followup_Transfer(&data) && status.length == 25); ++tests;
    data.qtd.token = 0x200;
    assert(USBHost::followup_Transfer(&data) && status.length == 25); ++tests;
    status.driver = &driver; data.qtd.token = 0x100 | (9u << 16);
    assert(USBHost::followup_Transfer(&data) && status.length == 25); ++tests;
    status.driver = nullptr; pipe.type = 2;
    assert(USBHost::followup_Transfer(&data) && status.length == 25); ++tests;
    pipe.type = 0; pipe.callback_function = nullptr;
    assert(USBHost::followup_Transfer(&data) && status.length == 25); ++tests;
    data.next_followup = nullptr;
    assert(USBHost::followup_Transfer(&data)); ++tests;
    pipe.diagnostic_completions = pipe.diagnostic_errors = 0;
    Transfer_t lifecycle;
    lifecycle.pipe = &pipe; lifecycle.qtd.token = 0x8000;
    assert(USBHost::followup_Transfer(&lifecycle) && pipe.diagnostic_completions == USBHOST_T36_ENABLE_DIAGNOSTICS); ++tests;
    lifecycle.qtd.token = 0x8008;
    assert(USBHost::followup_Transfer(&lifecycle) && pipe.diagnostic_errors == USBHOST_T36_ENABLE_DIAGNOSTICS); ++tests;

    #if USBHOST_T36_ENABLE_DIAGNOSTICS
    for (uint32_t initial_irq : {0u, 1u}) {
        irq_state = initial_irq;
        USBHS_USBCMD = 0x00080031;
        USBHS_USBSTS = 0x0000c000;
        USBHS_USBINTR = 0x01000007;
        USBHS_FRINDEX = 123;
        USBHS_ASYNCLISTADDR = 0x20001000;
        async_pipe_head = reinterpret_cast<Pipe_t *>(uintptr_t(0x20002000));
        USBHS_PORTSC1 = 0x1005;
        USBHost::enumeration_busy = initial_irq != 0;
        const auto controller = USBHost::getControllerDiagnosticInfo();
        assert(controller.command == USBHS_USBCMD && controller.status == USBHS_USBSTS);
        assert(controller.interrupt_enable == USBHS_USBINTR && controller.frame_index == USBHS_FRINDEX);
        assert(controller.async_address == USBHS_ASYNCLISTADDR && controller.port_status == USBHS_PORTSC1);
        assert(controller.async_software_head == reinterpret_cast<uintptr_t>(async_pipe_head));
        assert(controller.enumerating == USBHost::enumeration_busy && irq_state == initial_irq);
        assert(USBHS_USBCMD == 0x00080031 && USBHS_USBSTS == 0x0000c000);
        ++tests;
    }
    for (uint32_t initial_irq : {0u, 1u}) {
        irq_state = initial_irq;
        Device_t first_device = {}, second_device = {};
        Pipe_t control, bulk, periodic, other_bulk;
        first_device.control_pipe = &control;
        first_device.data_pipes = &bulk;
        first_device.next = &second_device;
        first_device.idVendor = 0x2e8a; first_device.idProduct = 0x10c1;
        first_device.address = 6; first_device.hub_address = 2; first_device.hub_port = 2;
        second_device.data_pipes = &other_bulk;
        second_device.address = 7;
        bulk.type = other_bulk.type = 2;
        periodic.type = 3;
        bulk.next = &periodic;
        bulk.qh.token = 0x80;
        bulk.qh.current = 0xdeadbeef;
        bulk.qh.next = 0xbad00001;
        bulk.qh.capabilities[1] = 0x01020000;
        bulk.diagnostic_submissions = 7;
        bulk.diagnostic_completions = 5;
        bulk.diagnostic_errors = 2;
        control.qh.horizontal_link = reinterpret_cast<uintptr_t>(&bulk) | 2;
        control.qh.capabilities[0] = 0x8000;
        devlist = &first_device;
        async_followup_first = nullptr;
        USBHost::PipeDiagnosticInfo samples[3] = {};
        samples[1].pending_count = 99;
        assert(USBHost::getAsyncPipeDiagnostics(samples, 3) == 3);
        assert(samples[0].address == reinterpret_cast<uintptr_t>(&control));
        assert(samples[0].horizontal_link == control.qh.horizontal_link && samples[0].capabilities1 == 0x8000);
        assert(samples[1].address == reinterpret_cast<uintptr_t>(&bulk) && samples[1].type == 2);
        assert(samples[1].vid == 0x2e8a && samples[1].pid == 0x10c1 && samples[1].device_address == 6);
        assert(samples[1].hub == 2 && samples[1].port == 2 && samples[1].token == 0x80);
        assert(samples[1].current == 0xdeadbeef && samples[1].next == 0xbad00001);
        assert(samples[1].capabilities2 == 0x01020000);
        assert(samples[1].transfer_submissions == 7 && samples[1].transfer_completions == 5);
        assert(samples[1].transfer_errors == 2);
        assert(samples[1].pending_count == 0 && samples[1].active_count == 0);
        assert(samples[1].first_pending == 0 && samples[1].first_pending_next == 0 && samples[1].first_pending_token == 0);
        assert(!samples[1].next_is_pending && !samples[1].followup_truncated); ++tests;
        assert(samples[2].address == reinterpret_cast<uintptr_t>(&other_bulk) && samples[2].device_address == 7);
        assert(irq_state == initial_irq && bulk.qh.token == 0x80 && bulk.qh.current == 0xdeadbeef); ++tests;
        samples[2].address = 0;
        assert(USBHost::getAsyncPipeDiagnostics(samples, 2) == 2 && samples[2].address == 0); ++tests;
        assert(USBHost::getAsyncPipeDiagnostics(nullptr, 3) == 0);
        assert(USBHost::getAsyncPipeDiagnostics(samples, 0) == 0 && irq_state == initial_irq); ++tests;
        bulk.next = &bulk;
        assert(USBHost::getAsyncPipeDiagnostics(samples, 3) == 3 && irq_state == initial_irq); ++tests;
        bulk.next = &periodic;
        alignas(32) Transfer_t completed, active, unrelated;
        completed.pipe = active.pipe = &bulk;
        unrelated.pipe = &other_bulk;
        completed.qtd.token = 0x8000;
        active.qtd.token = 0x00408182;
        unrelated.qtd.token = 0x80;
        completed.qtd.next = reinterpret_cast<uintptr_t>(&active);
        completed.next_followup = &unrelated;
        unrelated.next_followup = &active;
        async_followup_first = &completed;
        bulk.qh.next = reinterpret_cast<uintptr_t>(&active);
        assert(USBHost::getAsyncPipeDiagnostics(samples, 3) == 3);
        assert(samples[0].pending_count == 0 && samples[2].pending_count == 1 && samples[2].active_count == 1);
        assert(samples[1].pending_count == 2 && samples[1].active_count == 1);
        assert(samples[1].first_pending == reinterpret_cast<uintptr_t>(&completed));
        assert(samples[1].first_pending_next == reinterpret_cast<uintptr_t>(&active) && samples[1].first_pending_token == 0x8000);
        assert(samples[1].next_is_pending && !samples[1].followup_truncated);
        assert(completed.next_followup == &unrelated && unrelated.next_followup == &active && active.next_followup == nullptr);
        assert(completed.qtd.token == 0x8000 && active.qtd.token == 0x00408182 && irq_state == initial_irq); ++tests;
        bulk.qh.next = reinterpret_cast<uintptr_t>(&unrelated);
        assert(USBHost::getAsyncPipeDiagnostics(samples, 3) == 3 && !samples[1].next_is_pending); ++tests;
        bulk.qh.next = 1;
        assert(USBHost::getAsyncPipeDiagnostics(samples, 3) == 3 && !samples[1].next_is_pending); ++tests;
        active.next_followup = &completed;
        assert(USBHost::getAsyncPipeDiagnostics(samples, 3) == 3 && samples[1].followup_truncated && irq_state == initial_irq); ++tests;
        active.next_followup = nullptr;
        async_followup_first = nullptr;
        devlist = nullptr;
    }
    #endif
    test_root_port_acknowledgement();
    assert(USBHOST_T36_ENABLE_DIAGNOSTICS || cache_flushes == 0);
    std::cout << "PASS: " << tests << " enumeration/root-port regression cases (CERR=" << USBHOST_T36_QTD_CERR
              << ", diagnostics=" << USBHOST_T36_ENABLE_DIAGNOSTICS << ")\\n";
}
`;

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'usb-enumeration-'));
try {
    const executable = path.join(directory, process.platform === 'win32' ? 'test.exe' : 'test');
    const compiler = process.env.CXX || 'g++';
    const layoutSource = `
typedef unsigned int uint32_t;
typedef unsigned short uint16_t;
typedef unsigned char uint8_t;
struct Device_t;
struct USBDriver;
struct setup_t { uint32_t word1, word2; };
typedef struct Transfer_struct Transfer_t;
typedef struct Pipe_struct Pipe_t;
${extractFunction('USBHost_t36.h', 'struct Pipe_struct {', '// Transfer_t represents')}
${extractFunction('USBHost_t36.h', 'struct Transfer_struct {', '/************************************************/')}
static_assert(sizeof(void *) == 4, "Layout check requires 32-bit pointers");
static_assert(sizeof(Pipe_t) == 96, "Pipe telemetry must reuse existing padding");
static_assert(__builtin_offsetof(Pipe_t, qh) == 0, "QH must start at the pipe address");
static_assert(sizeof(((Pipe_t *)0)->qh) == 48, "EHCI QH layout must stay unchanged");
static_assert(sizeof(Transfer_t) == 64, "Transfer pool stride must stay unchanged");
static_assert(__builtin_offsetof(Transfer_t, qtd) == 0, "qTD must start at the transfer address");
static_assert(sizeof(((Transfer_t *)0)->qtd) == 32, "EHCI qTD layout must stay unchanged");
`;
    for (const diagnostics of [0, 1]) {
        const layoutBuild = spawnSync(compiler, [
            '-m32', `-DUSBHOST_T36_ENABLE_DIAGNOSTICS=${diagnostics}`, '-std=c++11', '-Wall', '-Wextra', '-Werror', '-fsyntax-only', '-x', 'c++', '-',
        ], { input: layoutSource, encoding: 'utf8' });
        if (layoutBuild.error) throw layoutBuild.error;
        if (layoutBuild.status !== 0) throw new Error(layoutBuild.stderr || '32-bit pipe layout check failed');
        process.stdout.write(`PASS: production 32-bit DMA layouts (pipe=96 bytes, transfer=64 bytes, diagnostics=${diagnostics})\n`);
    }
    for (const diagnostics of [0, 1]) for (const retryLimit of [0, 3]) {
        const retryFlags = retryLimit === 0 ? [] : [`-DUSBHOST_T36_QTD_CERR=${retryLimit}`];
        const build = spawnSync(compiler, [
            '-std=c++11', '-Wall', '-Wextra', '-Werror', '-fsanitize=undefined',
            `-DUSBHOST_T36_ENABLE_DIAGNOSTICS=${diagnostics}`,
            ...retryFlags, '-x', 'c++', '-', '-o', executable,
        ], { input: source, encoding: 'utf8' });
        if (build.error) throw build.error;
        if (build.status !== 0) throw new Error(build.stderr || 'Host compile failed');
        const test = spawnSync(executable, [], { encoding: 'utf8', timeout: 10000 });
        process.stdout.write(test.stdout || '');
        process.stderr.write(test.stderr || '');
        if (test.error) throw test.error;
        if (test.status !== 0) throw new Error(`Host test failed: ${test.status} ${test.signal}`);
    }
} finally {
    fs.rmSync(directory, { recursive: true, force: true });
}