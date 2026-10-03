const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function extractFunction(file, startMarker, endMarker) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
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
struct Transfer_t;
struct Device_t;
struct setup_t {
    uint8_t bmRequestType = 0, bRequest = 0;
    uint16_t wValue = 0, wIndex = 0, wLength = 0;
};
struct Pipe_t {
    Device_t *device = nullptr;
    uint8_t type = 0;
    void (*callback_function)(const Transfer_t *) = nullptr;
    uint8_t direction = 0;
};
struct USBDriver {
    unsigned calls = 0;
    void control(const Transfer_t *) { ++calls; }
};
struct Device_t {
    Pipe_t *control_pipe;
    uint8_t enum_state, address, bDeviceClass, bDeviceSubClass, bDeviceProtocol;
    uint8_t bmAttributes, bMaxPower, speed, hub_address, hub_port;
    uint16_t idVendor, idProduct, LanguageID;
    void *strbuf;
    Device_t *next;
};
struct Transfer_t {
    struct { uint32_t token = 0; } qtd;
    Transfer_t *next_followup = nullptr;
    Pipe_t *pipe = nullptr;
    USBDriver *driver = nullptr;
    void *buffer = nullptr;
    uint32_t length = 0;
    setup_t setup;
};
struct USBHost {
    static bool enumeration_busy;
    static Device_t *new_Device(uint32_t, uint32_t, uint32_t);
    static Device_t *allocate_Device();
    static void free_Device(Device_t *) {}
    static void *allocate_string_buffer() { return nullptr; }
    static Pipe_t *new_Pipe(Device_t *, uint32_t, uint32_t, uint32_t, uint32_t);
    static void enumeration(const Transfer_t *);
    static bool followup_Transfer(Transfer_t *);
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
static uint8_t enumbuf[2048];
static setup_t enumsetup, last_request;
static uint16_t enumlen;
static Device_t device;
static Device_t *devlist = nullptr;
static Pipe_t pipe;
static bool queue_ok = true;
static unsigned queues, config_prints, string_prints, conversions, claims, tests;
static const uint8_t config[] = {
    9,2,25,0,1,1,0,128,50,9,4,0,0,1,1,3,0,0,7,5,0x81,2,64,0,1
};
static void mk_setup(setup_t &setup, uint8_t type, uint8_t request, uint16_t value, uint16_t index, uint16_t length) {
    setup.bmRequestType = type; setup.bRequest = request;
    setup.wValue = value; setup.wIndex = index; setup.wLength = length;
}
static void pipe_set_maxlen(Pipe_t *, uint32_t) {}
static void pipe_set_addr(Pipe_t *, uint32_t) {}
static uint32_t assign_address() { return 1; }
Device_t *USBHost::allocate_Device() { return &device; }
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
${extractFunction('enumeration.cpp', 'Device_t * USBHost::new_Device(', '\n\n// Control transfer callback function.')}
${extractFunction('enumeration.cpp', 'void USBHost::enumeration(const Transfer_t *transfer)', '\nvoid  USBHost::convertStringDescriptorToASCIIString')}
${extractFunction('ehci.cpp', 'bool USBHost::followup_Transfer(Transfer_t *transfer)', '\nvoid USBHost::followup_Error(void)')}
static void reset(uint8_t state) {
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
int main() {
    reset(0); queue_ok = false;
    assert(USBHost::new_Device(1, 0, 0) == &device); failed(); ++tests;
    reset(0); assert(USBHost::new_Device(1, 0, 0) == &device);
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
    reset(6); respond(0, 0x40); assert(device.enum_state == 12 && USBHost::enumeration_busy);
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

    test_root_port_acknowledgement();
    std::cout << "PASS: " << tests << " enumeration/root-port regression cases\\n";
}
`;

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'usb-enumeration-'));
try {
    const executable = path.join(directory, process.platform === 'win32' ? 'test.exe' : 'test');
    const compiler = process.env.CXX || 'g++';
    const build = spawnSync(compiler, [
        '-std=c++11', '-Wall', '-Wextra', '-Werror', '-fsanitize=undefined',
        '-x', 'c++', '-', '-o', executable,
    ], { input: source, encoding: 'utf8' });
    if (build.error) throw build.error;
    if (build.status !== 0) throw new Error(build.stderr || 'Host compile failed');
    const test = spawnSync(executable, [], { encoding: 'utf8', timeout: 10000 });
    process.stdout.write(test.stdout || '');
    process.stderr.write(test.stderr || '');
    if (test.error) throw test.error;
    if (test.status !== 0) throw new Error(`Host test failed: ${test.status} ${test.signal}`);
} finally {
    fs.rmSync(directory, { recursive: true, force: true });
}