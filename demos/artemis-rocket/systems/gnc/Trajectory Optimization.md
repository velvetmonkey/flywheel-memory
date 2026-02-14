---
type: component
subsystem: gnc
status: complete
owner: "[[Elena Rodriguez]]"
created: 2025-08-25
updated: 2026-01-02
---
# [[Trajectory optimization]]

## [[Overview]]

**[[Trajectory Optimization]]** is the mathematical [[Framework]] for computing optimal vehicle trajectories that minimize fuel consumption while satisfying mission constraints. [[This]] [[Note]] [[Documents]] the theoretical foundations and [[Computational]] methods used in the [[Landing Algorithm]].

**[[Key Concepts]]**:
- **[[Optimal Control Theory]]**: Mathematical framework for finding optimal trajectories
- **[[Convex Optimization]]**: Fast, reliable solution method (guaranteed convergence)
- **[[Successive Convexification]] (SCvx)**: Iterative method for non-convex problems

**[[Applications]] in Artemis**:
- **[[Ascent Trajectory]]**: Maximize altitude with thrust and aerodynamic constraints
- **[[Landing Trajectory]]**: Minimize fuel while landing softly at [[Target]] ([[See]] [[Landing Algorithm]])

This note is theoretical background; see [[Landing Algorithm]] for practical implementation.

---

## [[Optimal Control Problem Formulation]]

### [[General Form]]

**Objective**: Find [[Control]] input u(t) that minimizes [[Cost Function]] J

```
Minimize:   J = ∫[t0 to tf] L(x(t), u(t), t) dt + Φ(x(tf))

            where:
              L = running cost (e.g., fuel consumption)
              Φ = terminal cost (e.g., final position error)

Subject to:
  - Dynamics:       ẋ = f(x, u, t)
  - Initial state:  x(t0) = x0
  - Terminal state: x(tf) ∈ S (target set)
  - Path constraints: g(x, u, t) ≤ 0
  - Control limits:   u_min ≤ u(t) ≤ u_max
```

### Landing Problem Formulation

**Specific to Artemis Powered Descent**:

**States** (x):
```
x = [px, py, pz, vx, vy, vz, m]
    position (3D), velocity (3D), mass (propellant decreases)
```

**Controls** (u):
```
u = [Tx, Ty, Tz]
    thrust vector (3D, magnitude and direction)
```

**Dynamics**:
```
ṗ = v                           (position derivative = velocity)
v̇ = (1/m) * T + g               (velocity derivative = thrust/mass + gravity)
ṁ = -||T|| / (Isp * g0)         (mass derivative = fuel consumption)

where:
  T = thrust vector [Tx, Ty, Tz]
  g = [0, 0, -9.81] m/s² (gravity)
  Isp = 290 s (specific impulse, see [[Engine Design]])
  g0 = 9.81 m/s² (standard gravity)
```

**Cost Function**:
```
J = ∫ ||T|| dt
    Minimize total thrust magnitude (proportional to fuel consumption)
```

**Constraints**:
```
Terminal:
  x(tf) = [0, 0, 0, vx, vy, vz, m]  (land at origin)
  ||v(tf)|| ≤ 5 m/s                  (soft touchdown)

Path:
  thrust_min ≤ ||T|| ≤ thrust_max    (engine throttle range)
  pz / sqrt(px² + py²) ≥ tan(30°)   (glide slope constraint)
```

---

## Convex Optimization Primer

### Why Convex Optimization?

**Problem**: General optimal control problems are **non-convex** (multiple local minima, no guarantee of finding global optimum)

**Solution**: Transform to **convex problem** (single global minimum, guaranteed convergence)

**Convex Problem Properties**:
1. **Objective**: Convex function (bowl-shaped)
2. **Constraints**: Convex set (intersection of half-spaces)
3. **Solution**: Unique global optimum (if exists)
4. **Computation**: Fast solvers (interior-point methods, <1 second for typical problems)

### Convex vs. Non-Convex

**Example: Fuel-Optimal Landing**

**Non-Convex Formulation** (original problem):
```
Minimize: ∫ ||T|| dt

Dynamics: v̇ = T/m + g  (NONLINEAR: T/m term)
```

**Convex Formulation** (after relaxation):
```
Minimize: ∫ ||T|| dt  (CONVEX: L1 norm is convex)

Dynamics: v̇ = T/m_ref + g  (LINEARIZED: m_ref = constant reference mass)

Constraint: ||T|| ≤ T_max  (CONVEX: Norm constraint)
```

**Trade-off**: Linearization introduces approximation error, but enables fast guaranteed solution

---

## Successive Convexification (SCvx)

### Algorithm Overview

**Key Idea**: Iteratively solve convex approximations of non-convex problem

**Steps**:
1. **Initialize**: Guess initial trajectory x⁽⁰⁾, u⁽⁰⁾
2. **Linearize**: Linearize dynamics around current trajectory
3. **Solve**: Solve convex optimization problem (fast, guaranteed)
4. **Update**: Use solution as new reference trajectory
5. **Repeat**: Until convergence (typically 3-5 iterations)

### Mathematical Details

**Iteration k: Linearize Dynamics**

Given reference trajectory (x̄, ū), linearize dynamics at each timestep:

```
Nonlinear: ẋ = f(x, u)

Linearized: ẋ ≈ f(x̄, ū) + A(x - x̄) + B(u - ū)

where:
  A = ∂f/∂x |_(x̄,ū)  (Jacobian w.r.t. state)
  B = ∂f/∂u |_(x̄,ū)  (Jacobian w.r.t. control)
```

**Example: Rocket Dynamics Linearization**

```
Nonlinear: v̇ = T/m + g

Reference: v̄̇ = T̄/m̄ + g

Linearize T/m around (T̄, m̄):
  T/m ≈ T̄/m̄ + (1/m̄)(T - T̄) - (T̄/m̄²)(m - m̄)
      = (1/m̄)T - (T̄/m̄²)m + constant

Linearized dynamics:
  v̇ ≈ (1/m̄)T - (T̄/m̄²)m + g + constant
     = A*v + B*T + C*m + d  (linear in states and controls)
```

### Discretization

**Continuous-Time → Discrete-Time**

Optimal control formulated in continuous time, but solved discretely:

```
Continuous: ẋ = f(x, u)

Discrete (Euler integration):
  x[k+1] = x[k] + dt * f(x[k], u[k])
         = x[k] + dt * (A*x[k] + B*u[k] + c)
         = (I + dt*A)*x[k] + (dt*B)*u[k] + dt*c

  x[k+1] = Ā*x[k] + B̄*u[k] + c̄  (discrete-time linear dynamics)
```

**Time Discretization for Artemis**:
```
Time horizon: 20 seconds (landing burn)
Timestep: dt = 0.5 seconds (40 discretization points)
```

### Convex Optimization Problem (at each iteration)

**Decision Variables**:
```
x[k] for k = 0, 1, ..., N  (state trajectory, N+1 points)
u[k] for k = 0, 1, ..., N-1  (control trajectory, N points)
```

**Objective**:
```
Minimize: Σ ||u[k]|| * dt  (discrete approximation of ∫||T|| dt)
```

**Constraints**:
```
Dynamics:    x[k+1] = Ā[k]*x[k] + B̄[k]*u[k] + c̄[k]  for k=0..N-1
Initial:     x[0] = x_current (current vehicle state)
Terminal:    x[N] = x_target (landing pad position and soft velocity)
Control:     ||u[k]|| ≤ u_max  for k=0..N-1
Glide Slope: pz[k] ≥ 0.577 * sqrt(px[k]² + py[k]²)  for k=0..N
```

**Solver**: CVXPY with ECOS backend (Embedded Conic Solver)

---

## Convergence Analysis

### Trust Region Method

**Problem**: Linearization only valid near reference trajectory (small deviations)

**Solution**: Add trust region constraint (limit trajectory change per iteration)

```
Trust Region Constraint:
  ||x[k]⁽ⁱ⁺¹⁾ - x[k]⁽ⁱ⁾|| ≤ ρ  for all k

  where:
    ρ = trust region radius (e.g., 100 m for position)
    i = iteration number
```

**Adaptive Trust Region**:
```python
if ||x_new - x_ref|| > ρ:
    # Solution outside trust region - reduce ρ
    ρ = 0.5 * ρ
    re_solve()
elif convergence_fast:
    # Convergence fast - increase ρ
    ρ = 1.5 * ρ
```

### Convergence Criteria

**SCvx converges when**:

```
||x⁽ⁱ⁺¹⁾ - x⁽ⁱ⁾|| < ε_x  (state trajectory change small)
||u⁽ⁱ⁺¹⁾ - u⁽ⁱ⁾|| < ε_u  (control trajectory change small)

Typical values:
  ε_x = 1 m (position), 0.1 m/s (velocity)
  ε_u = 100 N (thrust)
```

**Typical Convergence**: 3-5 iterations (300-500 ms total computation)

---

## Computational Complexity

### Problem Size Scaling

**Landing Problem**:
```
States:       n = 7 (px, py, pz, vx, vy, vz, m)
Controls:     m = 3 (Tx, Ty, Tz)
Timesteps:    N = 40 (20 seconds / 0.5 second dt)

Total variables:  (n+m)*N = (7+3)*40 = 400 variables
```

**ECOS Solver Complexity**:
```
Time Complexity: O(N³) for N variables (interior-point method)

For N=400: 400³ = 64 million operations
On 1.5 GHz CPU: ~100 ms per solve (empirical)
```

**SCvx Iterations**: 5 iterations × 100 ms = 500 ms (worst-case)

### Sparsity Exploitation

**Observation**: Dynamics constraint creates **sparse** matrix structure

```
Dynamics: x[k+1] = A*x[k] + B*u[k]

Constraint matrix:
  [x[1]]   [A  B  0  0  0]   [x[0]]
  [x[2]] = [0  A  B  0  0] * [u[0]]
  [x[3]]   [0  0  A  B  0]   [x[1]]
  ...                         ...

Sparse matrix (90% zeros) → faster solve (50 ms instead of 100 ms)
```

---

## Alternative Methods

### Direct Methods vs. Indirect Methods

**Direct Method** (used in Artemis):
- Discretize states and controls
- Solve large optimization problem
- **Pros**: Easy to add constraints, guaranteed convergence
- **Cons**: Approximate (discretization error)

**Indirect Method** (not used):
- Solve Pontryagin's Maximum Principle (calculus of variations)
- Analytical necessary conditions
- **Pros**: Exact solution (if solvable)
- **Cons**: Hard to solve (nonlinear boundary value problem), no guarantee of convergence

### Dynamic Programming

**Bellman's Principle of Optimality**:
```
V(x, t) = min[u] { L(x, u) + V(f(x, u), t+dt) }

Solve backward in time:
  V(x, T) = Φ(x)  (terminal cost)
  V(x, t) = ...   (work backward to t=0)
```

**Limitation**: **Curse of dimensionality**
- Computational cost: O(N^d) where d = state dimension
- For d=7 (Artemis states), infeasible (billions of grid points)

**Not used for Artemis** (too slow for real-time)

---

## Testing and Validation

### Benchmark Problems

**Goddard Problem** (classic rocket trajectory optimization):
```
Maximize: Final altitude

Subject to:
  - Dynamics: ḣ = v, v̇ = (T - D)/m - g, ṁ = -T/c
  - Drag: D = 0.5 * ρ(h) * v² * A
  - Thrust: 0 ≤ T ≤ T_max

Analytical Solution: Bang-bang control (T=0 or T=T_max)

SCvx Solution: Matches analytical within 1% ✅
```

### Landing Simulation Validation

**Compare SCvx to Grid Search** (brute-force):

```
Grid Search: Try all possible thrust profiles (exhaustive)
  - Computation: 10 hours (1 million trajectories)
  - Optimal fuel: 1250 kg

SCvx: Iterative optimization
  - Computation: 400 ms (5 iterations)
  - Optimal fuel: 1248 kg (0.2% difference) ✅
```

**[[Conclusion]]**: SCvx finds near-optimal solution 90,000× [[Faster]]

---

## [[Related Notes]]

**Algorithms**:
- [[Landing Algorithm]] - Practical implementation of SCvx
- [[Autopilot Software]] - Trajectory tracking

**GNC**:
- [[GNC System]] - Parent overview
- [[Flight Software]] - [[Software]] [[Integration]]

**[[Testing]]**:
- [[Avionics Integration]] - [[HIL Testing]]
- [[Test Campaign Overview]] - Simulation [[Validation]]

**[[Team]]**:
- [[Elena Rodriguez]] - [[Avionics Lead]] (algorithm [[Design]])
- [[Sarah Chen]] - [[Chief Engineer]] ([[Requirements]])
