---
type: decision
status: accepted
date: 2025-08-15
updated: 2025-08-15
decision_makers:
  - "[[Sarah Chen]]"
  - "[[Marcus Johnson]]"
tags:
  - adr
  - propulsion
  - decision
---
# ADR-001: [[Propellant Selection]]

## [[Status]]

**Accepted** - 2025-08-15

## [[Context]]

The [[Artemis Rocket]] requires a propellant combination for the main [[Engine Design]]. The choice of propellants drives the entire [[Propulsion System]] [[Design]], including tanks, pumps, cooling, and [[Performance]] [[Characteristics]].

**[[Key Constraints]]**:
- Budget: $14M total program budget (limits exotic propellants)
- Timeline: 18-month development (favors proven technology)
- Team size: 15 people (limits complexity)
- Performance target: 250kg to LEO (modest capability)
- Reusability: Propulsive landing required (engine restart capability)

## Decision

**Selected: LOX/RP-1 (Liquid Oxygen / Rocket-grade Kerosene)**

The main engine will use liquid oxygen (LOX) as the oxidizer and RP-1 (rocket-grade kerosene) as the fuel, in a gas generator cycle configuration.

## Alternatives Considered

### Option 1: LOX/LH2 (Liquid Oxygen / Liquid Hydrogen)

**Advantages**:
- Highest specific impulse (ISP ~450s vacuum)
- Best mass efficiency
- Clean combustion (H2O exhaust)

**Disadvantages**:
- Cryogenic hydrogen extremely difficult to handle (-253°C)
- Large tank volume required (low density)
- Expensive ground support equipment
- Complex insulation and boiloff management
- Limited flight heritage for small rockets
- **Cost estimate**: +$3M over LOX/RP-1 (exceeds budget)

**[[Conclusion]]**: Rejected - too complex and expensive for program constraints

### [[Option 2]]: NTO/MMH ([[Nitrogen Tetroxide]] / Monomethylhydrazine)

**Advantages**:
- Storable propellants (room temperature)
- Simple tank design (no cryogenics)
- Flight-proven for spacecraft

**Disadvantages**:
- Lower ISP (~290s vacuum) than LOX/LH2
- Highly toxic (hazardous [[Ground Operations]])
- Expensive propellants ($50/kg vs $2/kg for LOX/RP-1)
- [[Limited]] commercial [[Use]] (harder to source)
- Environmental [[Concerns]] (toxic exhaust)

**Conclusion**: Rejected - toxicity and cost issues outweigh storability benefits

### [[Option 3]]: LOX/Methane ([[Liquid Oxygen]] / [[Liquid Methane]])

**Advantages**:
- [[Good]] ISP (~350s vacuum, between RP-1 and LH2)
- Cleaner combustion than RP-1 (less coking)
- Potentially lower cost if sourced from [[Natural]] gas
- SpaceX Raptor heritage (modern approach)

**Disadvantages**:
- Still cryogenic (-161°C, similar challenges to LH2)
- Less flight heritage than LOX/RP-1
- More complex than RP-1 (cryogenic fuel)
- Larger tanks than RP-1 (lower density)
- **[[Risk]]**: [[First]]-time use for our team

**Conclusion**: Rejected - [[Added]] complexity [[Not]] justified for modest performance gain

### [[Option 4]]: LOX/RP-1 (Selected)

**Advantages**:
- Proven [[Technology]] ([[Falcon 9]], Atlas V, Soyuz, Saturn V heritage)
- Simple to handle (RP-1 is room temperature liquid)
- Dense propellant (compact tanks)
- Inexpensive ($2-5/kg total propellant cost)
- Good ISP (~290s sea level, ~315s vacuum)
- Team expertise (several members have RP-1 experience)
- Gas generator cycle simple and reliable

**Disadvantages**:
- Lower ISP than LOX/LH2 or LOX/Methane
- Coking issues in regenerative cooling (manageable)
- RP-1 not fully renewable (fossil fuel based)

**Conclusion**: **SELECTED** - best balance of performance, cost, and simplicity

## Rationale

The decision to use LOX/RP-1 was driven by the following factors:

### 1. Budget Constraints

**Program budget**: $14M [[Total]]
- LOX/RP-1 propellant cost: ~$10K per flight (negligible)
- Ground support equipment: $200K (commercial LOX + RP-1 tanks)
- Development cost: Baseline

**Comparison**:
- LOX/LH2 [[Would]] add $3M for cryogenic hydrogen systems
- NTO/MMH would add $500K for toxic propellant [[Handling]]
- LOX/Methane would add $1M for cryogenic methane systems

**Verdict**: LOX/RP-1 fits budget with margin

### 2. Schedule Constraints

**Development timeline**: 18 months to first flight
- LOX/RP-1 has extensive flight heritage (design patterns proven)
- Team members have prior experience (reduces learning curve)
- Suppliers readily available (no long-lead procurement)

**Risk reduction**:
- Gas generator cycle is simplest rocket engine cycle
- Regenerative cooling with RP-1 is well-understood
- No exotic materials required

**Verdict**: LOX/RP-1 minimizes schedule risk

### 3. Performance Requirements

**Mission**: 250kg to 500km LEO
- Required delta-v: ~9.5 km/s
- LOX/RP-1 ISP: 290s (sea level), 315s (vacuum)
- Mass ratio achievable: 12:1 (propellant : dry mass)

**Analysis**:
- LOX/RP-1 provides adequate ISP for mission
- Dense propellants enable compact vehicle (shorter, stiffer structure)
- Performance margin sufficient for reusability (propulsive landing)

**Verdict**: LOX/RP-1 meets performance requirements with margin

### 4. Operational Simplicity

**Ground operations**:
- RP-1 is room-temperature liquid (simple storage, no boiloff)
- LOX is cryogenic but well-understood (commercial infrastructure)
- No toxic propellants (simpler safety procedures)
- Propellant loading can be done by small team

**Flight operations**:
- Engine restart capability proven (SpaceX Falcon 9 landing)
- RP-1 stable for hours in tank (no boiloff issues)
- LOX boiloff manageable with simple insulation

**Verdict**: LOX/RP-1 enables lean operations

## Implications

### Propulsion System Design

[[Engine Design]]:
- Gas generator cycle with turbopump-fed combustion
- Regenerative cooling using RP-1 fuel as coolant
- Pintle injector for throttling and combustion stability
- Target: 45 kN thrust (sea level), ISP 290s

[[Turbopump]]:
- Single-shaft design (LOX + RP-1 pumps on same shaft)
- Turbine driven by fuel-rich gas generator
- Pump pressure rise: 12 MPa (LOX), 15 MPa (RP-1)

[[Fuel Tanks]]:
- Aluminum 2219 construction (room-temperature RP-1)
- GN2 pressurization (no cryogenic complications)
- 95 liters usable volume (76 kg RP-1)

[[Oxidizer System]]:
- Aluminum 2219 with spray-on foam insulation (cryogenic LOX)
- Autogenous GOX pressurization (vaporized LOX from engine heat)
- 145 liters usable volume (165 kg LOX)
- Oxygen cleaning per ASTM G93 (safety critical)

[[Cooling System]]:
- Regenerative cooling with RP-1 fuel
- 360 milled copper channels in combustion chamber
- Fuel temperature rise: 50°C (15°C → 65°C)
- Chamber wall temperature <650°C

### Performance Estimates

**Delivered Performance** (based on engine design):
- Thrust (sea level): 44.2 kN (measured in [[Engine Hot Fire Results]])
- Thrust (vacuum): 48.5 kN (calculated)
- ISP (sea level): 287s (measured, 99% of target)
- ISP (vacuum): 315s (calculated)
- Burn time: 240s (full mission duration)
- Mixture ratio: 2.38:1 (O/F mass ratio)

**Vehicle Performance**:
- Propellant mass: 241 kg (165 kg LOX + 76 kg RP-1)
- Dry mass estimate: 20 kg (vehicle structural mass)
- Mass ratio: 12:1 (favorable for small rocket)
- Payload capacity: 250 kg to 500 km LEO (meets requirement)

### Cost Impact

**Development Cost Savings** (vs alternatives):
- LOX/RP-1 vs LOX/LH2: **-$3M** (no cryogenic H2 [[Systems]])
- LOX/RP-1 vs NTO/MMH: **-$500K** (no toxic handling)
- LOX/RP-1 vs LOX/Methane: **-$1M** (no cryogenic CH4 systems)

**[[Operational Cost]]** (per flight):
- RP-1 propellant: ~$300 (76 kg @ $4/kg)
- LOX propellant: ~$150 (165 kg @ $1/kg)
- Total propellant cost: **~$450 per flight**

**Ground Support**:
- LOX tank + vaporizer: $100K (commercial equipment)
- RP-1 storage tank: $50K (commercial fuel tank)
- Loading equipment: $50K (pumps, hoses, valves)
- Total GSE: **$200K** ([[One]]-time [[Investment]])

### [[Risk Assessment]]

**[[Technical Risks]]**:
- ✅ Low - LOX/RP-1 proven across 60+ years of spaceflight
- ✅ [[Regenerative Cooling]] well-understood
- ✅ [[Gas Generator]] cycle simplest [[Engine]] [[Architecture]]

**[[Safety Risks]]**:
- ⚠️ Medium - LOX is cryogenic oxidizer (fire hazard if leaked)
- ✅ Low - RP-1 is non-toxic (safer than hypergolics)
- ✅ [[Oxygen Cleaning Procedures]] well-[[Established]]

**[[Operational Risks]]**:
- ✅ Low - Commercial LOX readily [[Available]]
- ✅ Low - RP-1 similar to Jet-A fuel (aviation [[Infrastructure]])
- ✅ No special permits [[Required]] (vs toxic propellants)

## [[Stakeholder Approval]]

**Decision makers**:
- [[Sarah Chen]] ([[Chief Engineer]]) - **Approved**
- [[Marcus Johnson]] ([[Propulsion Lead]]) - **Approved**

**Consulted**:
- [[Elena Rodriguez]] ([[Avionics Lead]]) - Supports (simple operations)
- [[James Park]] ([[Structures Lead]]) - Supports (dense propellants = compact tanks)
- [[Team Roster]] - [[Propulsion Team]] consensus

**Decision [[Date]]**: 2025-08-15
**Review date**: N/A (decision is final)

## [[Related Decisions]]

- [[ADR-004 Test Campaign]] - [[Test]] [[Strategy]] for propulsion [[Validation]]
- Future ADR: [[Engine Cycle Selection]] (gas generator chosen)
- Future ADR: Thrust level sizing (45 kN [[Target]])

## [[References]]

- Sutton, G. P., & Biblarz, O. (2016). *[[Rocket Propulsion Elements]]* (9th ed.). Wiley.
- SpaceX Falcon 9 [[Data]] (LOX/RP-1 heritage, gas generator cycle)
- NASA [[Propellant Selection Guide]] (cryogenic vs storable trade study)

**[[Related Notes]]**:
- [[Propulsion System]] - [[System]]-level architecture
- [[Engine Design]] - Implementation of [[This]] decision
- [[Turbopump]] - Propellant pumping system
- [[Fuel Tanks]] - RP-1 storage
- [[Oxidizer System]] - LOX storage and cryogenic handling
- [[Cooling System]] - RP-1 regenerative cooling
- [[Project Roadmap]] - Impact on schedule
- [[Budget Tracker]] - Cost impact

---

*Decision recorded by [[Sarah Chen]] - 2025-08-15*
*Status: Accepted and [[Implemented]]*
