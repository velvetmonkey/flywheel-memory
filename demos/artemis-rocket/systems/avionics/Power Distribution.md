---
type: component
subsystem: avionics
status: testing
owner: "[[Elena Rodriguez]]"
created: 2025-09-16
updated: 2026-01-02
---
# [[Power Distribution]]

## [[Overview]]

The Artemis power distribution [[System]] provides reliable electrical power to [[All]] vehicle subsystems throughout the mission. The [[Design]] uses a centralized [[Battery Pack]] with [[Multiple]] voltage regulators to deliver regulated power buses at different voltage levels (28V, 12V, 5V, 3.3V).

**[[Key Features]]**:
- [[Primary Power]]: Lithium-polymer battery pack (28V nominal)
- Multiple regulated voltage buses for different loads
- Overcurrent protection on all power channels
- Real-time [[Monitoring]] of voltage, [[Current]], temperature
- Graceful degradation (non-critical loads shed under low battery)

**[[Design Philosophy]]**: Simplicity and [[Reliability]] over [[Optimization]]

## [[Battery System]]

### [[Battery Selection]]

**[[Selected Battery]]**: Turnigy 10000mAh 6S Lithium-Polymer (LiPo)

**Specifications**:
- Chemistry: Lithium-Polymer (LiPo)
- Capacity: 10,000 mAh (10 Ah)
- Voltage: 22.2V nominal (6S = 6 cells × 3.7V)
- Voltage range: 19.2V (discharged) to 25.2V (fully charged)
- Discharge [[Rate]]: 25C continuous (250A max continuous)
- Energy: 222 Wh
- Mass: 880g
- Dimensions: 165mm × 60mm × 50mm

**Why LiPo**:
- [[High]] energy density: 250 Wh/kg (vs. 50 Wh/kg for [[Lead]]-acid)
- High discharge rate: Can [[Provide]] 250A bursts (needed for igniter pyrotechnics)
- Readily [[Available]]: RC hobby battery (low cost, short lead time)
- Flight-proven in UAVs and model rockets
- Cost: $150 per pack

**Trade-Off**: LiPo vs. Lithium-Ion
- LiPo: Higher discharge rate, lower cost, less safe (thermal runaway risk)
- Li-Ion: Lower discharge rate, higher cost, safer (better thermal stability)
- Decision: Use LiPo for first flight (short mission duration reduces thermal risk), migrate to Li-Ion for reusable vehicle

### Battery Mounting

**Location**: Electronics bay (center of vehicle)

**Mechanical**:
- Battery secured in aluminum tray with hook-and-loop straps
- Tray bolted to vehicle frame (4× M6 bolts)
- Vibration isolation: 4× rubber grommets between tray and frame
- Fire containment: Tray lined with fireproof Kevlar fabric (contains fire if battery fails)

**Thermal Management**:
- Passive cooling (no active cooling required for short mission)
- Thermal sensor (NTC thermistor) bonded to battery pack
- Warning threshold: 50°C (battery warming, monitor closely)
- Critical threshold: 60°C (emergency landing, battery thermal runaway imminent)

### Battery Management System (BMS)

**BMS Function**:
- Cell balancing: Ensures all 6 cells charge/discharge evenly
- Overcharge protection: Cuts charging if any cell exceeds 4.25V
- Over-discharge protection: Cuts load if any cell drops below 3.0V
- Over-current protection: Limits discharge current to 250A
- Temperature monitoring: Cuts load if battery temperature exceeds 60°C

**BMS Integration**:
- BMS built into battery pack (no external BMS required)
- Status monitored via voltage/current sensors (see Monitoring section)
- Emergency cutoff: BMS can disconnect battery if fault detected

## Power Buses

### 28V Primary Bus

**Source**: Battery pack (direct connection)

**Voltage Range**: 19.2V - 25.2V (battery state-of-charge dependent)

**Loads** (28V tolerant devices):
- [[Engine Controller]]: 15W average, 30W peak
- Propellant valves (solenoid): 50W during actuation (1s), 0W holding
- Pyrotechnic igniter: 200W for 2s (battery provides 250A burst)
- Backup power distribution (redundant bus)

**Overcurrent Protection**: 30A circuit breaker (TE Connectivity W28 series)

### 12V Regulated Bus

**Regulator**: Vicor DCM3623 (DC-DC buck converter)

**Input**: 28V primary bus
**Output**: 12V ± 0.5V, 5A max
**Efficiency**: 92%
**Quiescent power**: 0.5W

**Loads**:
- [[Sensor Suite]] voltage/current monitors: 0.5W
- [[Telemetry]] data logger (SD card): 1W
- Backup avionics (if primary 5V/3.3V fail): 3W

**Overcurrent Protection**: 5A electronic fuse (TI TPS2595)

### 5V Regulated Bus

**Regulator**: Texas Instruments TPS54560 (DC-DC buck converter)

**Input**: 12V regulated bus (cascaded from 28V → 12V → 5V)
**Output**: 5V ± 0.25V, 10A max
**Efficiency**: 90%

**Loads**:
- [[Flight Computer]] (3× Raspberry Pi CM4): 9W total (3W each)
- [[Sensor Suite]] (IMUs, GPS, pressure sensors): 5W total
- [[Communications]] radios (2× Microhard): 6W total (3W each)
- Miscellaneous (LEDs, indicators): 1W

**Total 5V Load**: ~21W (4.2A @ 5V)

**Overcurrent Protection**: 10A electronic fuse (TI TPS2595)

### 3.3V Regulated Bus

**Regulator**: Linear Technology LT1764 (LDO linear regulator)

**Input**: 5V regulated bus
**Output**: 3.3V ± 0.1V, 3A max
**Efficiency**: 66% (linear regulator, not switching)

**Why Linear Regulator**:
- Low noise (switching regulators can cause EMI)
- Simple design (no external inductor required)
- Acceptable efficiency loss (only 1.6W heat dissipation)

**Loads**:
- [[Sensor Suite]] (I2C/SPI peripherals): 1W
- [[Telemetry]] UART interfaces: 0.5W
- Microcontroller peripherals: 0.5W

**Total 3.3V Load**: ~2W (0.6A @ 3.3V)

**Overcurrent Protection**: 3A electronic fuse (TI TPS2595)

## Power Sequencing

**T-30 minutes**: Ground power connected (umbilical)
- Battery charging (if needed)
- Avionics powered from ground (battery not discharged)

**T-10 minutes**: Switch to internal power
- Disconnect ground power umbilical
- Activate battery primary bus (28V)
- Sequentially enable voltage regulators:
  1. 12V bus (T-9:55)
  2. 5V bus (T-9:50)
  3. 3.3V bus (T-9:45)
- [[Flight Computer]] boots (T-9:40)
- [[Sensor Suite]] initialization (T-9:30)
- [[Communications]] link established (T-9:00)

**T-10 seconds**: High-power loads enabled
- [[Engine Controller]] powered (T-10s)
- Propellant valve power enabled (T-5s)

**T-0**: Igniter fired
- 200W pulse for 2 seconds (pyrotechnic igniter)
- Battery provides 250A burst (within discharge rating)

**T+600 seconds** (post-landing): Power down sequence
- Disable high-power loads (engine controller, valves)
- Wait 60 seconds (allow telemetry to transmit landing confirmation)
- Disable avionics (flight computers, radios, sensors)
- Disconnect battery (BMS cuts power)

## Monitoring and Protection

### Voltage/Current Monitoring

**Sensors**: INA219 (I2C current/voltage monitor IC)
- **6 monitoring points**:
  1. Battery voltage and current (28V bus)
  2. 12V regulator output
  3. 5V regulator output
  4. 3.3V regulator output
  5. Engine controller power
  6. Propellant valve power

**Sampling Rate**: 10 Hz (100ms period)

**Logged Data** (transmitted via [[Telemetry]]):
- Voltage (each bus)
- Current (each bus)
- Power consumption (calculated: P = V × I)
- Battery state-of-charge (estimated from voltage)

**Fault Detection**:
- Under-voltage: (90% nominal voltage
- Over-current: )110% expected current
- Over-temperature: Battery >50°C (warning), >60°C (critical)

### Overcurrent Protection

**Circuit Breakers** (28V bus):
- Type: Resettable electronic circuit breaker (E-T-A ESX10)
- Trip current: 30A (protects battery from short circuit)
- Reset: Automatic (breaker resets after fault cleared)

**Electronic Fuses** (12V, 5V, 3.3V buses):
- Type: TI TPS2595 eFuse IC
- Features:
  - Programmable current limit (set via resistor)
  - Fast response ((10μs trip time)
  - Overcurrent status flag (monitored by Flight Software)
  - Auto-retry or latch-off modes

**Fuse Coordination**:
- 3.3V bus: 3A fuse (protects LDO regulator)
- 5V bus: 10A fuse (protects buck converter)
- 12V bus: 5A fuse (protects buck converter)
- 28V bus: 30A circuit breaker (protects battery)

Cascaded protection ensures downstream fuse trips before upstream (prevents nuisance tripping)

### Thermal Management

**Heat Dissipation**:
- Voltage regulators mounted to aluminum heat spreaders
- Heat spreaders bolted to vehicle frame (vehicle acts as heat sink)
- Passive cooling (no fans required for short mission duration)

**Thermal Budget**:
- 12V regulator: 1.5W dissipation (92% efficient, 28V → 12V, 1.5A load)
- 5V regulator: 2.5W dissipation (90% efficient, 12V → 5V, 4.2A load)
- 3.3V regulator: 1.6W dissipation (66% efficient, 5V → 3.3V, 0.6A load)
- **Total heat**: 5.6W (easily dissipated by aluminum frame)

**Thermal Sensors**:
- Battery NTC thermistor (monitors battery temperature)
- Regulator temperature sensors (internal to IC, monitored via I2C)

## Load Shedding Strategy

**Purpose**: Extend battery life if mission duration exceeds estimate (e.g., delayed landing)

**Battery State-of-Charge Thresholds**:
- 100% - 50%: All systems powered (normal operation)
- 50% - 30%: Shed non-critical loads (telemetry data logger, backup radios)
- 30% - 20%: Shed high-bandwidth telemetry (reduce rate from 100 Hz to 10 Hz)
- 20% - 10%: Critical avionics only ([[Flight Computer]], primary [[Communications]], [[Sensor Suite]])
- <10%: Emergency landing mode (engine shutdown, deploy parachute)

**Load Shedding Implementation**:
- Flight Software monitors battery voltage via INA219 sensors
- Estimates state-of-charge from voltage (using lookup table)
- Automatically disables non-critical loads when threshold reached
- Operator notified via telemetry (warning message)

## Integration

### Power Distribution Board (PDB)

**Custom PCB Design**:
- 4-layer PCB (signal, ground, power, signal)
- Dimensions: 120mm × 80mm
- Mounted in electronics bay (adjacent to battery)

**Components on PDB**:
- Voltage regulators (12V, 5V, 3.3V)
- Electronic fuses (TPS2595)
- Voltage/current monitors (INA219)
- Connectors for battery, loads, sensors

**Connector Types**:
- Battery input: XT60 (high-current connector, 60A rating)
- Regulated outputs: JST-XH (2-pin for power, color-coded)
- Monitoring interfaces: I2C bus (shared with Flight Computer)

### Wiring Harness

**Wire Gauge** (based on current and length):
- 28V primary bus: 12 AWG (5mm²) - 30A capacity
- 12V bus: 18 AWG (1mm²) - 10A capacity
- 5V bus: 18 AWG (1mm²) - 10A capacity
- 3.3V bus: 22 AWG (0.5mm²) - 5A capacity

**Cable Management**:
- Cables zip-tied to vehicle frame (prevents vibration fatigue)
- Color-coded wires (red = positive, black = ground, yellow = signal)
- Connectors torqued to specification (prevents loosening)

## Testing

### Benchtop Testing

**Load Testing**:
- Procedure: Apply full load to each bus, measure voltage regulation
- Result:
  - 28V bus: 25.2V (fully charged) to 19.8V (50% discharged)
  - 12V bus: 12.05V ± 0.05V (excellent regulation)
  - 5V bus: 5.02V ± 0.02V (excellent regulation)
  - 3.3V bus: 3.31V ± 0.01V (excellent regulation)

**Efficiency Testing**:
- Measured power input vs. output for each regulator
- Result:
  - 12V regulator: 91.5% efficient (close to spec: 92%)
  - 5V regulator: 89.8% efficient (close to spec: 90%)
  - 3.3V regulator: 65% efficient (as expected for linear regulator)

**Overcurrent Protection Testing**:
- Procedure: Short-circuit each bus, verify fuse trips
- Result: All fuses tripped within 15μs, no damage to regulators

### Integrated Vehicle Testing

**HIL Testing** (see [[Avionics Integration Test]]):
- Power distribution integrated with flight computers and sensors
- 100 simulated flight profiles executed (full mission duration)
- Battery discharge monitored throughout
- Result: ✅ Battery capacity sufficient for 600s mission + 100s margin

**Vibration Testing**:
- Power distribution board subjected to 14.1 Grms random vibration
- Result: ✅ No connector loosening, no solder joint failures, regulators functional

**Thermal Vacuum Testing**:
- Chamber: -40°C to +70°C, <1×10⁻⁵ Torr
- Duration: 8 hours (4 thermal cycles)
- Result: ✅ All regulators maintained regulation across temperature range

## Power Budget

| System | Voltage | Current | Power | Duty Cycle | Avg Power |
|--------|---------|---------|-------|------------|-----------|
| [[Flight Computer]] (3×) | 5V | 1.8A | 9W | 100% | 9W |
| [[Sensor Suite]] (IMU, GPS, pressure) | 5V | 1.0A | 5W | 100% | 5W |
| [[Communications]] (2× radios) | 5V | 1.2A | 6W | 50% TX | 3W |
| [[Telemetry]] (data logger) | 12V | 0.1A | 1W | 100% | 1W |
| [[Engine Controller]] | 28V | 0.5A | 15W | 100% (flight) | 15W |
| Propellant valves | 28V | 2A | 50W | 5% (actuation) | 2.5W |
| Pyrotechnic igniter | 28V | 8A | 200W | 0.3% (2s pulse) | 0.6W |
| Miscellaneous | 3.3V | 0.3A | 1W | 100% | 1W |
| **Total** | | | **287W** | | **37W** |

**Battery Capacity Analysis**:
- Battery energy: 222 Wh
- Average power consumption: 37W
- Mission duration: 600s (10 minutes)
- Energy required: 37W × (600s / 3600s/h) = 6.2 Wh
- **Margin**: 222 Wh / 6.2 Wh = **36× margin** (battery massively oversized)

**Why Oversized Battery**:
- Burst loads (igniter, valve actuation) require high discharge rate (25C)
- Small batteries cannot provide 250A burst (even if capacity adequate)
- Future growth (add cameras, additional sensors, longer mission)
- Cost-effective (RC battery inexpensive compared to custom pack)

## Lessons Learned

### What Worked Well

1. **Commercial Battery Exceeded Expectations**
   - Turnigy LiPo delivered 250A igniter pulse without voltage sag
   - No thermal issues (battery stayed <40°C throughout tests)
   - Cost: $150 (vs. $2000+ for [[Custom]] aerospace battery)

2. **[[Cascaded Voltage Regulation Simple]] and Reliable**
   - 28V → 12V → 5V → 3.3V approach worked flawlessly
   - Easy to troubleshoot (measure voltage at [[Each]] stage)
   - Flexible for future additions (add new loads at any voltage level)

3. **[[Electronic Fuses Fast]] and Effective**
   - TPS2595 eFuses tripped [[Faster]] than [[Traditional]] fuses (<15μs)
   - [[Auto]]-retry [[Feature]] allowed transient recovery (e.g., valve inrush current)
   - Saved mass (no bulky fuse holders)

### [[Challenges Encountered]]

1. **[[Igniter Inrush Current]]**
   - Initial design: 5A fuse on 28V bus
   - Problem: Igniter drew 8A for 2s, tripped fuse
   - Solution: Increased fuse to 30A circuit breaker (handles burst)
   - Lesson [[Learned]]: [[Account]] for inrush current in fuse sizing

2. **[[Voltage Droop During Valve]] Actuation**
   - Propellant valve solenoids drew 2A inrush (50W), caused 0.5V droop on 28V bus
   - Impact: Brief undervoltage on [[Flight Computers]] ([[Not]] critical [[But]] concerning)
   - Solution: [[Added]] 1000μF [[Bulk]] capacitor on 28V bus (absorbs transient)
   - [[Result]]: Voltage droop reduced to <0.1V

3. **[[Heat Dissipation]] in [[Thermal Vacuum]]**
   - 3.3V LDO regulator overheated in vacuum (no convective cooling)
   - Temperature reached 90°C (within spec but close to 125°C limit)
   - Solution: Enlarged heat spreader area (doubled thermal interface)
   - Result: Temperature reduced to 70°C (comfortable margin)

## [[Current Status]]

**[[Design Maturity]]**: 95% ([[Ready]] for CDR)

**[[Completed]]**:
- ✅ Battery selection and procurement
- ✅ Voltage regulator design and [[Testing]]
- ✅ Power distribution [[Board]] fabrication and assembly
- ✅ Load testing (benchtop and integrated vehicle)
- ✅ [[Environmental Testing]] (thermal vacuum, vibration)

**[[Remaining Work]]**:
- Final integrated vehicle power-on [[Test]] (verify all [[Systems]] [[Powered]] correctly)
- Battery charging [[Procedure Documentation]] (pre-flight checklist)

**Risks**:
- **R-020**: Battery thermal runaway - Mitigation: BMS protection, fire containment (Kevlar tray), thermal monitoring
- **R-021**: Power bus short circuit - Mitigation: Overcurrent protection (fuses, circuit breakers), smoke test before flight

## [[Future Enhancements]] (Post-[[First Flight]])

1. **Lithium-[[Ion Battery]]**: Migrate to 18650 Li-Ion cells (safer, longer life) for reusable vehicle
2. **[[Solar Panels]]**: Add solar charging for extended missions ()1 hour loiter time)
3. **[[Redundant Battery]]**: Dual battery packs with automatic failover (single-[[Fault Tolerance]])
4. **[[Higher Voltage Bus]]**: Increase primary bus to 48V (reduces wiring mass for high-power loads)

## [[Related Notes]]

**[[Avionics Subsystem]]**:
- [[Avionics System]] - Subsystem overview
- [[Flight Computer]] - Powered by 5V bus
- [[Sensor Suite]] - Powered by 5V and 3.3V buses
- [[Communications]] - Powered by 5V bus
- [[Telemetry]] - Powered by 12V bus

**[[Propulsion Subsystem]]**:
- [[Engine Controller]] - Powered by 28V bus
- [[Fuel Tanks]] / [[Oxidizer System]] - Valve power from 28V bus
- [[Ignition Sequence]] - Pyrotechnic igniter powered by 28V bus

**Testing**:
- [[Avionics Integration Test]] - [[HIL Testing]] [[Results]] ([[Power consumption]] [[Validated]])
- [[Test Campaign Overview]] - Overall test [[Strategy]]

**[[Project Management]]**:
- [[Project Roadmap]] - Power system [[Milestones]]
- [[Risk Register]] - R-020, R-021
- [[Team Roster]] - [[Elena Rodriguez]] ([[Avionics Lead]])

---

*[[Component Specification]] by [[Elena Rodriguez]] - [[Last Updated]] 2026-01-02*
