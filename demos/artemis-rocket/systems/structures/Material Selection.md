---
type: component
subsystem: structures
status: complete
owner: "[[James Park]]"
created: 2025-07-15
updated: 2026-01-02
---
# [[Material Selection]]

## [[Overview

Material]] selection is [[One]] of the [[Most]] critical [[Design Decisions]] for [[Launch]] vehicle structures. The Artemis-1 program conducted comprehensive trade studies to select materials that optimize the conflicting [[Requirements]] of **strength**, **weight**, **cost**, and **manufacturability**.

[[This]] [[Note]] [[Documents]] the material selection process and rationale for [[All]] primary structural [[Components]]:

| Component | [[Material Selected]] | [[Key Driver]] | Mass (kg) |
|-----------|-------------------|------------|-----------|
| [[Airframe Design\|Airframe]] Shell | Aluminum-[[Lithium 2195]]-T8 | Strength-to-weight, weldability | 215 |
| [[Fairing Design\|Fairing]] | [[Carbon Fiber]] (T700S/8552 epoxy) | Mass savings, stiffness | 18 |
| [[Landing System\|Landing Legs]] | [[Carbon]] [[Fiber]] (primary strut) | Mass savings, reusability | 13 |
| [[Landing System\|Landing Legs]] | Aluminum-Lithium 2195 (secondary strut) | Cost, toughness | 6 |
| [[Stage Separation\|Interstage]] | Aluminum-Lithium 2195-T8 | Heritage, manufacturability | 22 |
| [[Engine Mount]] | [[Titanium Ti]]-6Al-4V | [[High]]-temperature, strength | 12 |
| Fasteners | A286 [[Stainless Steel]] | [[Corrosion Resistance]], strength | 8 |
| **[[Total]]** | | | **294 kg** |

**[[Material Philosophy]]**:
- **Airframe**: Aluminum-lithium for weldability and heritage (proven SpaceX [[Falcon 9]] usage)
- **Fairing**: Carbon fiber for mass savings (12 kg lighter than aluminum, critical for [[Payload Capacity]])
- **[[Landing Legs]]**: Carbon fiber for reusability (lower fatigue damage, longer service life)
- **Fasteners**: Stainless steel for corrosion resistance (coastal launch environment)

[[See]] [[Airframe Design]], [[Fairing Design]], and [[Landing System]] for detailed component designs [[Using]] [[These]] materials.

---

## [[Material Requirements]]

### [[Structural Requirements]]

**Strength**:
- **[[Yield Strength]]**: >400 MPa ([[Prevent]] permanent deformation under flight loads)
- **[[Ultimate Strength]]**: >500 MPa (1.5× factor of [[Safety]] for ultimate load)
- **[[Fracture Toughness]]**: >30 MPa·√m (prevent catastrophic crack propagation)

**Stiffness**:
- **Young's Modulus**: >70 GPa (minimize structural deflection and vibration)
- **[[Specific Stiffness]]**: E/ρ >26×10⁶ m²/s² (stiffness-to-weight ratio)

**Fatigue**:
- **[[Endurance Limit]]**: >200 MPa (for reusable components, 10 flight cycles)
- **[[Crack Growth Rate]]**: (1×10⁻⁸ m/cycle (slow crack growth for damage tolerance)

### [[Environmental Requirements]]

**[[Temperature Range]]**:
- **Cryogenic**: -65°C (LOX propellant exposure)
- **[[Aerodynamic Heating]]**: +120°C (max-Q, transonic heating)
- **[[Engine Proximity]]**: +200°C ([[Aft Bulkhead]], near [[Engine Design]] plume)

**Corrosion Resistance**:
- **Environment**: Coastal launch [[Site]] (salt spray, humidity)
- **Exposure**: 6 months outdoor storage before flight
- **Protection**: Anodizing, coatings, or inherent corrosion resistance

**[[Thermal Cycling]]**:
- **Cycles**: Propellant [[Loading]]/unloading (thermal shock from cryogenic exposure)
- **Range**: -65°C to +50°C (200+ degree temperature swing)
- **Requirement**: No cracking, no delamination [[After]] 10 cycles

### [[Manufacturing Requirements]]

**Weldability**:
- **Process**: [[Tungsten Inert Gas]] (TIG) welding preferred ([[Automated]], high quality)
- **[[Filler Compatibility]]**: Filler materials readily [[Available]] (ER2319 for Al-Li, ER70S-6 for steel)
- **Post-[[Weld Properties]]**: )80% of base metal strength (minimize heat-affected zone degradation)

**Machinability**:
- **[[Tool Wear]]**: Low tool wear (aluminum preferred over titanium or stainless steel)
- **[[Surface Finish]]**: Ra (3.2 μm (achievable with standard tooling)
- **[[Dimensional Stability]]**: Low residual stress (minimize distortion during machining)

**Availability**:
- **[[Lead Time]]**: <12 [[Weeks]] (long-[[Lead]] materials procured early in program)
- **[[Supplier Base]]**: )2 domestic suppliers (U.S. ITAR [[Compliance]], [[Supply Chain]] resilience)
- **Form**: Standard mill forms (plate, sheet, tube) - avoid [[Custom]] extrusions

---

## [[Material Candidates]]

### [[Aluminum Alloys]]

#### 1. [[Aluminum 6061]]-T6 ([[General]]-[[Purpose]])

**Properties**:
```
Density:              2700 kg/m³
Yield Strength:       276 MPa
Ultimate Strength:    310 MPa
Young's Modulus:      69 GPa
Fracture Toughness:   29 MPa·√m
Specific Stiffness:   25.6×10⁶ m²/s²
```

**Advantages**:
- ✅ Excellent weldability (most common welded aluminum alloy)
- ✅ Low cost ($3/kg, baseline for comparison)
- ✅ Wide availability (every metal supplier stocks 6061)
- ✅ Good corrosion resistance (anodizes well)

**Disadvantages**:
- ❌ Lower strength than Al-Li (276 MPa vs. 520 MPa yield)
- ❌ Heavier structure (requires thicker sections for same strength)
- ❌ No heritage in modern launch vehicles (Falcon 9, Electron use Al-Li)

**Verdict**: **Rejected** for primary structure (too heavy, low strength)
- **Retained** for secondary components (foot pads, non-structural brackets)

#### 2. Aluminum 7075-T6 (High-Strength)

**Properties**:
```
Density:              2810 kg/m³
Yield Strength:       505 MPa
Ultimate Strength:    572 MPa
Young's Modulus:      72 GPa
Fracture Toughness:   25 MPa·√m
Specific Stiffness:   25.6×10⁶ m²/s²
```

**Advantages**:
- ✅ Higher strength than 6061 (505 MPa vs. 276 MPa yield)
- ✅ Lower density than steel (2810 kg/m³ vs. 7850 kg/m³)
- ✅ Proven aerospace use (aircraft structures, military applications)

**Disadvantages**:
- ❌ Poor weldability (susceptible to hot cracking, porosity)
- ❌ Corrosion-prone (requires protection in coastal environments)
- ❌ Lower fracture toughness than Al-Li (25 vs. 35 MPa·√m)

**Verdict**: **Rejected** for welded structures (poor weldability)
- **Could be used** for machined components (if welding not required)

#### 3. Aluminum-Lithium 2195-T8 (Spaceflight Grade) ✅

**Properties**:
```
Density:              2700 kg/m³ (same as 6061, lithium content lowers density)
Yield Strength:       520 MPa (88% higher than 6061)
Ultimate Strength:    570 MPa
Young's Modulus:      78 GPa (13% higher than 6061)
Fracture Toughness:   35 MPa·√m (21% higher than 6061)
Specific Stiffness:   28.9×10⁶ m²/s² (13% higher than 6061)
Cryogenic Properties: Strength increases at -65°C (favorable for LOX tanks)
```

**Advantages**:
- ✅ **Best strength-to-weight** among aluminum alloys (520 MPa / 2700 kg/m³)
- ✅ **Excellent weldability** (ER2319 filler, minimal strength loss)
- ✅ **Cryogenic-compatible** (strength increases at -65°C, no embrittlement)
- ✅ **Spaceflight heritage**: NASA Space Shuttle External Tank, SpaceX Falcon 9, ULA Atlas V
- ✅ **Fracture toughness**: Damage-tolerant design (slow crack growth)

**Disadvantages**:
- ❌ **Higher cost**: $42/kg (14× more expensive than 6061)
- ❌ **Long lead time**: 12 weeks (specialty alloy, fewer suppliers)
- ❌ **Requires post-weld heat treatment** (stress relief at 170°C)

**Verdict**: **SELECTED** for airframe, interstage, secondary struts ✅
- **Rationale**: Strength-to-weight and weldability outweigh cost for primary structure

**Suppliers**:
- **Alcoa** (U.S. domestic supplier, ITAR-compliant)
- **Constellium** (secondary source, Europe-based but U.S. facility)

---

### Composite Materials

#### 4. Carbon Fiber Reinforced Polymer (CFRP) ✅

**Material System**: Toray T700S carbon fiber + Hexcel 8552 epoxy resin

**Properties** (quasi-isotropic layup, [0°/±45°/90°]ₛ):
```
Density:              1600 kg/m³ (40% lighter than aluminum)
Tensile Strength:     600 MPa (fiber direction)
Compressive Strength: 450 MPa (fiber direction)
Young's Modulus:      70 GPa (similar to aluminum)
Specific Stiffness:   43.8×10⁶ m²/s² (71% higher than aluminum)
CTE:                  1×10⁻⁶ /°C (very low, dimensionally stable)
Max Service Temp:     120°C continuous, 250°C short-term
```

**Advantages**:
- ✅ **Highest specific stiffness** (43.8×10⁶ m²/s², best among all candidates)
- ✅ **Low density** (1600 kg/m³, 40% lighter than aluminum)
- ✅ **Corrosion immune** (no oxidation, ideal for coastal environment)
- ✅ **Low thermal expansion** (dimensionally stable during thermal cycling)
- ✅ **Fatigue-resistant** (no fatigue limit like metals, excellent for reusability)

**Disadvantages**:
- ❌ **High cost**: $80/kg material + $200/kg labor (5× more expensive than Al-Li)
- ❌ **Not weldable** (must be bonded or bolted, limits joints)
- ❌ **Lower temperature limit** (120°C vs. aluminum's 200°C)
- ❌ **Requires autoclave** (specialized equipment, longer lead time)
- ❌ **Brittle failure mode** (no plastic deformation warning before failure)

**Verdict**: **SELECTED** for fairing and landing legs ✅
- **Rationale**: Mass savings (12-18 kg) justify higher cost for payload-critical components

**Manufacturing Process**:
1. Hand layup or automated fiber placement (AFP) - place prepreg plies
2. Vacuum bag - seal layup, apply vacuum to remove air
3. Autoclave cure - 180°C, 85 psi, 2 hours (epoxy cures, consolidates plies)
4. Post-cure inspection - ultrasonic C-scan (detect voids, delamination)

#### 5. Glass Fiber Reinforced Polymer (GFRP)

**Properties**:
```
Density:              1800 kg/m³
Tensile Strength:     400 MPa
Young's Modulus:      30 GPa (57% lower than CFRP)
Specific Stiffness:   16.7×10⁶ m²/s² (62% lower than CFRP)
Max Service Temp:     150°C
```

**Advantages**:
- ✅ Lower cost than CFRP ($15/kg vs. $80/kg)
- ✅ Higher temperature tolerance than CFRP (150°C vs. 120°C)
- ✅ Good electrical insulation (useful for RF-transparent structures)

**Disadvantages**:
- ❌ Lower stiffness than CFRP (30 GPa vs. 70 GPa)
- ❌ Heavier than CFRP for same strength (1800 kg/m³ vs. 1600 kg/m³)
- ❌ No performance advantage over aluminum (E/ρ = 16.7 vs. Al-Li 28.9)

**Verdict**: **Rejected** (CFRP superior in every way except cost)

---

### Metals (High-Temperature)

#### 6. Titanium Ti-6Al-4V ✅

**Properties**:
```
Density:              4430 kg/m³
Yield Strength:       880 MPa
Ultimate Strength:    950 MPa
Young's Modulus:      114 GPa
Fracture Toughness:   55 MPa·√m
Specific Stiffness:   25.7×10⁶ m²/s²
Max Service Temp:     400°C (superior to aluminum's 200°C)
```

**Advantages**:
- ✅ **Highest strength** among metals (880 MPa yield, 70% higher than Al-Li)
- ✅ **High-temperature capability** (400°C, ideal for engine mounts)
- ✅ **Excellent corrosion resistance** (forms protective oxide layer, no coating needed)
- ✅ **Fracture toughness** (55 MPa·√m, damage-tolerant)

**Disadvantages**:
- ❌ **High density** (4430 kg/m³, 64% heavier than aluminum)
- ❌ **Expensive**: $35/kg (5× more expensive than 6061, but cheaper than CFRP)
- ❌ **Difficult to machine** (high tool wear, slow cutting speeds)
- ❌ **Not weldable in field** (requires inert atmosphere, specialized equipment)

**Verdict**: **SELECTED** for engine mounts and landing leg fittings ✅
- **Rationale**: High-temperature capability and strength required at engine interface
- **Usage**: Small quantity (12 kg total), cost justified for critical application

#### 7. Stainless Steel A286

**Properties**:
```
Density:              7850 kg/m³
Yield Strength:       725 MPa
Ultimate Strength:    1000 MPa
Young's Modulus:      200 GPa
Max Service Temp:     650°C
```

**Advantages**:
- ✅ **Highest stiffness** among common metals (200 GPa, 2.6× aluminum)
- ✅ **Corrosion-resistant** (stainless, no coating required)
- ✅ **High-temperature** (650°C, best among candidates)
- ✅ **Low cost**: $8/kg (comparable to aluminum)

**Disadvantages**:
- ❌ **High density** (7850 kg/m³, 2.9× heavier than aluminum)
- ❌ **[[Poor]] [[Specific]] stiffness** (E/ρ = 25.5, similar to aluminum [[Despite]] high E)

**Verdict**: **SELECTED** for fasteners [[Only]] (bolts, nuts) ✅
- **Rationale**: Corrosion resistance for coastal environment, small mass impact (8 kg total fasteners)

---

## [[Trade Study Results]]

### [[Airframe Material Trade]]

**Objective**: Select material for [[Airframe Design]] cylindrical shell ([[Primary Structure]], largest mass component)

**Candidates**:
1. Aluminum 6061-T6 (baseline, lowest cost)
2. Aluminum-Lithium 2195-T8 (spaceflight [[Grade]])
3. Carbon Fiber T700S/8552 (highest [[Performance]])

**[[Trade Matrix]]**:

| Criterion | Weight | [[Al 6061]] | Al-[[Li 2195]] | CFRP |
|-----------|--------|---------|------------|------|
| **[[Structural Mass]]** (kg) | 40% | 350 | 215 | 180 |
| **[[Material Cost]]** ($K) | 20% | 4.2 | 13.0 | 42.0 |
| **Fabrication Cost** ($K) | 20% | 12 | 18 | 65 |
| **Lead Time** (weeks) | 10% | 4 | 12 | 16 |
| **[[Heritage Risk]]** | 10% | High | Low | Med |
| **[[Weighted Score]]** | | **62** | **78** | **71** |

**[[Scoring]]**:
- **Structural Mass**: CFRP lightest (180 kg), Al-Li middle (215 kg), 6061 heaviest (350 kg)
- **Cost**: 6061 cheapest ($16K total), Al-Li middle ($31K), CFRP most expensive ($107K)
- **Lead Time**: 6061 fastest (4 weeks), Al-Li medium (12 weeks), CFRP longest (16 weeks)
- **Heritage**: Al-Li proven (Falcon 9), CFRP medium (Electron fairing), 6061 high risk (no modern heritage)

**Sensitivity Analysis**:
- If **mass is critical** (payload-limited mission): CFRP wins (180 kg, 35 kg lighter than Al-Li)
- If **cost is critical** (development budget-limited): 6061 wins ($16K vs. $31K)
- If **schedule is critical** (flight date-driven): 6061 wins (4 weeks vs. 12 weeks)

**Decision**: **Aluminum-Lithium 2195-T8** ✅
- **Rationale**:
  - Best balance of mass (215 kg, only 35 kg heavier than CFRP)
  - Proven spaceflight heritage (Falcon 9, Atlas V, Shuttle External Tank)
  - Weldable (enables monocoque construction, see [[Airframe Design]])
  - Cost acceptable ($31K material + fab, within $50K budget)
- **Trade-off Accepted**: 35 kg heavier than CFRP, but $76K cheaper ($107K vs. $31K)

### [[Fairing Material Trade]]

**Objective**: Select material for [[Fairing Design]] ([[Payload Protection]], jettisoned at 100 km)

**Candidates**:
1. Aluminum-Lithium 2195-T8 (heritage from airframe)
2. Carbon Fiber T700S/8552 (mass-[[Optimized]])

**Trade Matrix**:

| Criterion | Al-Li 2195 | CFRP |
|-----------|------------|------|
| **Mass** (kg) | 30 | 18 |
| **Cost** ($K) | 8 | 24 |
| **Acoustic Attenuation** (dB) | 12 | 15 |
| **Thermal Protection** | Not required | Required (2 mm ablative) |
| **Reusability** | No (expendable) | Possible (parachute recovery) |

**Key Factor**: **Payload Capacity**
- Every 1 kg saved in fairing = 1 kg additional payload
- 12 kg mass savings (CFRP vs. Al-Li) = 12 kg more revenue payload
- Revenue gain: 12 kg × $50K/kg (launch cost) = **$600K per flight**

**Decision**: **Carbon Fiber T700S/8552** ✅
- **Rationale**: Mass savings justify 3× higher cost ($24K vs. $8K)
- **ROI**: Fairing cost amortized over 1 flight (expendable), but enables $600K [[Revenue Gain]]
- **[[Bonus]]**: Better [[Acoustic Attenuation]] (15 dB vs. 12 dB), protects payload better

### [[Landing Leg Material Trade]]

**Objective**: Select material for [[Landing System]] primary struts (reusable component)

**Candidates**:
1. Aluminum-Lithium 2195-T8 (heritage from airframe)
2. Carbon Fiber T700S/8552 (fatigue-resistant)

**Trade Matrix**:

| Criterion | Al-Li 2195 | CFRP |
|-----------|------------|------|
| **Mass per Leg** (kg) | 4.8 | 3.2 |
| **[[Total System Mass]]** (kg) | 19.2 | 12.8 |
| **Cost per Leg** ($K) | 3.2 | 8.5 |
| **Fatigue Life** (cycles) | 50 | 500 |
| **Impact Toughness** | High | Low |

**Key Factor**: **Reusability**
- Landing legs experience 10 flights (fatigue cycling)
- CFRP has no fatigue limit (composites don't fatigue like metals)
- Al-Li requires inspection after 50 cycles (NDT, crack detection)
- CFRP requires inspection after 500 cycles (10× longer service life)

**Decision**: **Carbon Fiber T700S/8552** (primary strut) ✅
- **Rationale**: Fatigue resistance critical for reusability (10 flight target)
- **Mass Savings**: 6.4 kg (19.2 kg Al-Li vs. 12.8 kg CFRP)
- **Cost**: Justified by reusability (save $20K/flight by [[Not]] replacing legs)

**[[Hybrid Approach]]**: CFRP primary strut + Al-Li secondary strut
- Primary strut: CFRP (main load path, fatigue-critical)
- Secondary strut: Al-Li (diagonal bracing, impact-tolerant)
- **Rationale**: Al-Li provides impact toughness (prevents brittle fracture during hard landings)

---

## [[Material Properties Summary]]

### [[Mechanical Properties Table]]

| Material | ρ (kg/m³) | σ_y (MPa) | E (GPa) | K_IC (MPa·√m) | E/ρ (10⁶ m²/s²) | Cost ($/kg) |
|----------|-----------|-----------|---------|---------------|-----------------|-------------|
| **Al 6061-T6** | 2700 | 276 | 69 | 29 | 25.6 | $3 |
| **[[Al 7075]]-T6** | 2810 | 505 | 72 | 25 | 25.6 | $6 |
| **Al-Li 2195-T8** ✅ | 2700 | 520 | 78 | 35 | 28.9 | $42 |
| **CFRP (T700S/8552)** ✅ | 1600 | 600 | 70 | N/A | 43.8 | $80 + $200 labor |
| **Ti-6Al-4V** ✅ | 4430 | 880 | 114 | 55 | 25.7 | $35 |
| **A286 Stainless** ✅ | 7850 | 725 | 200 | 45 | 25.5 | $8 |

**Legend**:
- ρ = Density
- σ_y = Yield strength
- E = Young's modulus (stiffness)
- K_IC = Fracture toughness
- E/ρ = Specific stiffness (performance metric)

**[[Best]]-in-[[Class]]**:
- **[[Highest Specific Stiffness]]**: CFRP (43.8×10⁶ m²/s²)
- **[[Highest Strength]]**: Titanium Ti-6Al-4V (880 MPa yield)
- **[[Best Cost]]**: Al 6061-T6 ($3/kg)
- **Best Balance**: Al-Li 2195-T8 (high strength, weldable, spaceflight heritage)

### Thermal Properties Table

| Material | CTE (10⁻⁶ /°C) | k (W/m·K) | Max Temp (°C) |
|----------|----------------|-----------|---------------|
| **Al 6061-T6** | 23.6 | 167 | 200 |
| **Al-Li 2195-T8** | 23.0 | 155 | 200 |
| **CFRP** | 1.0 | 5 | 120 (continuous), 250 (short-term) |
| **Ti-6Al-4V** | 8.6 | 7 | 400 |
| **A286 Stainless** | 16.0 | 14 | 650 |

**Legend**:
- CTE = Coefficient of thermal expansion (dimensional stability)
- k = Thermal conductivity (heat transfer)
- Max Temp = Maximum service temperature

**Key Observations**:
- **CFRP**: Lowest CTE (1.0, most dimensionally stable) but lowest max temp (120°C)
- **Titanium**: High max temp (400°C, ideal for engine mounts)
- **Stainless Steel**: Highest max temp (650°C, ideal for high-temperature fasteners)

---

## Cost Analysis

### Material Cost Breakdown

**Total Material Cost** (Artemis-1 vehicle):

| Component | Material | Qty | Unit Cost | Total Cost |
|-----------|----------|-----|-----------|------------|
| Airframe shell (310 kg) | Al-Li 2195 | 310 kg | $42/kg | $13,020 |
| Bulkheads (38 kg) | Al-Li 2195 | 38 kg | $42/kg | $1,596 |
| Fairing (18 kg) | CFRP | 18 kg | $80/kg | $1,440 |
| Landing legs (13 kg CFRP) | CFRP | 13 kg | $80/kg | $1,040 |
| Landing legs (6 kg Al-Li) | Al-Li 2195 | 6 kg | $42/kg | $252 |
| Engine mount (12 kg) | Ti-6Al-4V | 12 kg | $35/kg | $420 |
| Fasteners (8 kg) | A286 SS | 8 kg | $8/kg | $64 |
| **TOTAL** | | **405 kg** | | **$17,832** |

**[[Labor Cost]]** (fabrication and assembly):

| Component | Material | [[Labor Hours]] | [[Rate]] | Labor Cost |
|-----------|----------|-------------|------|------------|
| Airframe welding | Al-Li | 120 hr | $85/hr | $10,200 |
| Fairing layup & cure | CFRP | 40 hr | $125/hr | $5,000 |
| Landing leg fabrication | CFRP+Al-Li | 60 hr | $125/hr | $7,500 |
| Machining (all components) | Mixed | 80 hr | $95/hr | $7,600 |
| Assembly & [[Integration]] | Mixed | 100 hr | $85/hr | $8,500 |
| **[[TOTAL LABOR]]** | | **400 hr** | | **$38,800** |

**Total Structural Cost**: $17,832 (material) + $38,800 (labor) = **$56,632**

### [[Cost Comparison]] ([[What]]-[[If Analysis]])

**[[Scenario 1]]: All-Aluminum (6061-T6) [[Design]]**
- Material cost: $4,200 (7× cheaper than Al-Li)
- Labor cost: $32,000 (less welding time, [[Simpler]] fabrication)
- **[[Total Cost]]**: $36,200 (36% cheaper than baseline)
- **Penalty**: +135 kg structural mass (reduces payload capacity by 135 kg)
- **Revenue Loss**: 135 kg × $50K/kg = **$6.75M per flight** (far exceeds cost savings)

**Scenario 2: All-CFRP Design**
- Material cost: $32,400 (82% more expensive)
- Labor cost: $62,000 (60% more labor hours due to autoclave curing)
- **Total Cost**: $94,400 (67% more expensive than baseline)
- **Benefit**: -50 kg structural mass (50 kg more payload)
- **Revenue Gain**: 50 kg × $50K/kg = **$2.5M per flight**
- **ROI**: Cost [[Premium]] ($37K) amortized in (1 flight

**Conclusion**: Hybrid Al-Li + CFRP design is optimal
- Balances cost ($56K, [[Mid]]-range) and performance (215 kg airframe, 18 kg fairing)
- Pure aluminum too [[Heavy]] (payload-[[Limited]])
- Pure CFRP too expensive and not weldable (limits design options)

---

## [[Lessons Learned]]

### [[Design Phase]]

**[[Lesson 1]]**: Material selection [[Must]] [[Consider]] entire lifecycle cost, not just material cost
- **Observation**: CFRP fairing 3× more expensive than aluminum, [[But]] saves 12 kg
- **Analysis**: 12 kg mass savings = $600K revenue gain per flight (far exceeds $16K cost premium)
- **[[Conclusion]]**: Always perform revenue [[Impact Analysis]] for payload-critical components

**[[Lesson 2]]**: Weldability is critical for primary structure
- **Observation**: CFRP has best specific stiffness (43.8 vs. 28.9 for Al-Li)
- **Problem**: CFRP not weldable (must [[Use]] bolted or bonded joints)
- **Impact**: Limits design to fastened construction (heavier, more complex than monocoque)
- **Conclusion**: Al-Li selected for airframe despite lower specific stiffness (weldability enables lighter monocoque design)

**[[Lesson 3]]**: Reusability changes material selection [[Criteria]]
- **Observation**: Landing legs experience 10 flight cycles (fatigue-critical)
- **[[Traditional Approach]]**: Select highest strength material (titanium, 880 MPa)
- **[[Reusability Approach]]**: Select highest fatigue resistance (CFRP, no fatigue limit)
- **Conclusion**: CFRP selected despite lower strength (fatigue resistance more important for reusability)

### [[Procurement Phase]]

**[[Lesson 4]]**: Long lead times for specialty materials [[Are]] [[Critical Path]]
- **Observation**: Al-Li 2195 has 12-week lead time (vs. 4 weeks for 6061)
- **Impact**: [[Material Procurement]] became critical path (delayed [[Structural Test Article]] by 2 weeks)
- **Mitigation**: [[Ordered Al]]-Li immediately after [[Preliminary Design Review|PDR]] (before final design [[Complete]])
- **Future**: Build lead time into program schedule, order long-lead materials early

**[[Lesson 5]]**: Supplier qualification is [[Essential]] for ITAR-controlled materials
- **Observation**: Al-Li 2195 is ITAR-controlled (export restrictions)
- **Challenge**: [[Only 2]] U.S. suppliers (Alcoa, Constellium), limited competition
- **[[Risk]]**: Single supplier failure could delay program
- **Mitigation**: Dual-source procurement (split order between [[Both]] suppliers)

### [[Fabrication Phase]]

**[[Lesson 6]]**: CFRP autoclave curing requires tight temperature [[Control]]
- **Observation**: [[First]] fairing half over-cured by 10°C (brittle matrix, scrapped)
- **[[Root cause]]**: Autoclave temperature overshoot (poor thermocouple placement)
- **Fix**: [[Added]] [[Multiple]] thermocouples (6 locations), tighter PID control (±2°C)
- **[[Cost Impact]]**: $8K scrap cost (within contingency budget, but avoidable)

**Lesson 7**: Titanium machining is slow and expensive
- **Observation**: Titanium engine mounts took 3× longer to machine than estimated
- **Root Cause**: High tool wear (carbide tools dulled quickly), slow cutting speeds
- **Impact**: $2K additional machining cost (labor [[Hours]] exceeded estimate)
- **Future**: Use titanium castings instead of machined billets (reduce machining time by 60%)

---

## [[Current Status]]

**Material Procurement**: ✅ **Complete**
- Al-Li 2195: All material delivered (348 kg procured, 310 kg used, 38 kg scrap allowance)
- CFRP prepreg: All material delivered (25 kg procured, 31 kg used including scrap)
- Titanium Ti-6Al-4V: All material delivered (15 kg procured, 12 kg used)
- A286 fasteners: All delivered (custom bolt order, 8 kg total)

**[[Material Test Reports]]**: ✅ **Archived**
- Al-Li tensile [[Test]] coupons: 8 samples tested, all passed ()520 MPa yield)
- CFRP laminate coupons: 12 samples tested, 11 passed (1 failed due to void, acceptable)
- Titanium certification: Mill test reports on file (chemistry, tensile, fracture toughness)

**[[Lessons Incorporated]]**:
- ✅ Autoclave temperature control improved (±2°C, prevents over-cure)
- ✅ Dual-source Al-Li procurement (Alcoa primary, Constellium backup)
- ✅ Early material ordering (12 weeks before [[Need]] [[Date]])

**[[Open Issues]]**: [[None]] (all materials procured, tested, and in use)

---

## [[Related Notes]]

**[[Component Design]]**:
- [[Airframe Design]] - Al-Li 2195 monocoque construction
- [[Fairing Design]] - CFRP composite layup and autoclave cure
- [[Landing System]] - CFRP primary struts + Al-Li secondary struts

**[[Decisions]]**:
- [[ADR-006 Airframe Construction Method]] - Monocoque vs. semi-monocoque ([[Driven]] by weldability of Al-Li)

**[[Testing]]**:
- [[Test Campaign Overview]] - Material test coupon program
- [[Acme Aerospace]] - Material testing [[Services]] (tensile, fracture toughness)

**Suppliers**:
- [[Acme Aerospace]] - Fabrication and assembly services
- Alcoa - Al-Li 2195 supplier (not a note yet)
- Toray - T700S carbon fiber supplier (not a note yet)
- Hexcel - 8552 epoxy resin supplier (not a note yet)

**[[Project Management]]**:
- [[Project Roadmap]] - Material procurement schedule
- [[Risk Register]] - Material [[Supply]] chain risk
- [[Budget Tracker]] - Material cost tracking ($17.8K actual vs. $20K budget)

**[[Team]]**:
- [[James Park]] - [[Structures Lead]] (material selection authority)
- [[Sarah Chen]] - [[Chief Engineer]] (material selection [[Approval]])
