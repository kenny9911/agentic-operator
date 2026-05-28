# Michael Thompson

Embedded Firmware Engineer · Portland, OR · michael.thompson@example.com · 11 years experience

## Summary

Senior embedded firmware engineer with 11 years building safety-critical systems for medical devices and industrial automation. Deep expertise in C/C++ on bare-metal and RTOS targets (FreeRTOS, Zephyr), low-level driver development, and hardware-software integration. Strong track record of shipping FDA-cleared products. Looking to stay in the embedded / hardware space.

## Skills

- **Languages**: C (expert), C++ (expert, modern C++17/20), Rust (intermediate, hobby), assembly (ARM Cortex-M, AVR)
- **Embedded**: ARM Cortex-M (STM32, Nordic nRF52, Microchip SAM), FreeRTOS, Zephyr, bare-metal, low-power design, FreeRTOS+TCP, lwIP, USB, BLE, CAN, SPI/I2C/UART
- **Protocols / Standards**: IEC 62304 (medical SW lifecycle), DO-178C familiarity, MISRA C, ISO 26262 ASIL-B exposure
- **Tools**: GCC ARM, LLVM, OpenOCD, JTAG/SWD, Saleae logic analyzers, oscilloscopes
- **Build / CI**: CMake, Make, Yocto, Buildroot, GitLab CI
- **Some scripting**: Python (test harnesses, lab automation — ~1k LOC of Python in the last 3 years), occasional Bash

## Experience

### Principal Firmware Engineer — Helios Medical (insulin-pump startup) · 2019-now (6 yr)

- Tech lead for the firmware of an FDA-cleared continuous glucose monitor → insulin pump bridge. Cortex-M4 + custom BLE stack, ~80kLOC of C, hard real-time constraints.
- Owner of the safety-case documentation per IEC 62304 Class C.
- Designed the firmware OTA update mechanism (dual-bank, fail-safe rollback, signed images).
- Mentored 4 firmware engineers.

### Senior Firmware Engineer — Lattice Industrial Controls · 2014-2019 (5 yr)

- Shipped firmware for industrial motion controllers — ARM Cortex-M7, FreeRTOS, EtherCAT.
- Built the diagnostics + over-the-wire protocol; wrote the matching desktop debugger in C# (.NET Framework, WinForms).

## Side projects

- Currently building a custom mechanical keyboard with QMK firmware.
- Maintain a small open-source LoRa mesh-network demo (~150 stars).

## Education

- B.Eng. Electrical Engineering, Oregon State University (2014)
- M.S. Embedded Systems, Oregon State (2016)
