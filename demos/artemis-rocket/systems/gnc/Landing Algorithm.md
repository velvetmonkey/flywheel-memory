---
type: component
subsystem: gnc
status: complete
owner: "[[Elena Rodriguez]]"
created: 2025-08-20
updated: 2026-01-02
---
# [[Landing Algorithm]]

## [[Overview]]

The **Landing Algorithm** computes the optimal trajectory for [[Powered]] descent from 80 km apogee to [[Soft]] touchdown on the landing pad. [[Based]] on SpaceX's proven [[Powered Descent Guidance]] (PDG) algorithm, the Artemis implementation uses [[Convex Optimization]] to generate fuel-optimal trajectories in real-time.

**Algorithm**: [[Successive Convexification]] (SCvx)
- Solves [[Trajectory Optimization]] problem iteratively
- Converges to fuel-optimal solution in 3-5 iterations
- Computation time: <500 ms (runs on [[Flight Computer]])

**Performance**:
- **Landing Accuracy**: ±12 m (mean error from target)
- **Fuel Margin**: 15% propellant remaining at touchdown (safety buffer)
- **Success Rate**: 96% (47 of 49 simulated scenarios successful)

See [[Autopilot Software]] for trajectory tracking and [[GNC System]] for overall guidance strategy.

---

## Algorithm Overview

### Powered Descent Guidance (PDG)

**Objective**: Minimize propellant consumption while satisfying constraints

**Optimization Problem**:
```
Minimize:    ∫ ||thrust|| dt  (minimize fuel usage)

Subject to:
  - Dynamics:     ẋ = v, v̇ = thrust/m + g
  - Position:     x(t_final) = landing_pad (end at target)
  - Velocity:     v(t_final) < 5 m/s (soft touchdown)
  - Attitude:     ||thrust|| ≤ thrust_max (engine limit)
  - Glide Slope:  angle ≥ 30° (avoid plume-surface interaction)
  - Keep-Out:     x not in obstacles (buildings, terrain)
```

**Solution Method**: Successive Convexification (SCvx)
1. Linearize nonlinear dynamics around reference trajectory
2. Solve convex optimization problem (fast, guaranteed convergence)
3. Update reference trajectory with solution
4. Repeat until convergence (3-5 iterations, <500 ms)

**Heritage**: SpaceX Falcon 9, Blue Origin New Shepard (proven 200+ times)

---

## Trajectory Phases

### Phase 1: Boost-Back Burn (T+400s to T+420s)

**Objective**: Reverse horizontal velocity, return toward launch site

**Initial Conditions** (at T+400s, engine cutoff):
```
Altitude:       80 km (apogee)
Velocity:       2400 m/s (horizontal, downrange)
Position:       250 km downrange from launch site
```

**Guidance**:
```python
# Compute boost-back burn vector
target_position = launch_site  # [0, 0] in local coordinates
current_position = [250000, 80000]  # 250 km downrange, 80 km altitude

# Direction toward target
thrust_direction = normalize(target_position - current_position)

# Full thrust for 20 seconds
thrust = thrust_max * thrust_direction
```

**Burn Duration**: 20 seconds (T+400s to T+420s)
**Δv**: 800 m/s (reduces horizontal velocity from 2400 m/s to 1600 m/s)

**Outcome** (at T+420s):
```
Altitude:       75 km (descending)
Velocity:       1600 m/s (still downrange, but slowed)
Position:       200 km downrange
```

### Phase 2: Ballistic Descent (T+420s to T+460s)

**Objective**: Coast to 5 km altitude, no thrust (conserve fuel)

**Dynamics**: Free fall with atmospheric drag
```python
# Ballistic trajectory (no thrust)
acceleration = g + drag_force / mass

# Drag force (significant below 30 km)
drag_force = 0.5 * rho * v^2 * C_d * A
```

**Trajectory**:
```
T+420s:  75 km altitude, 1600 m/s velocity
T+440s:  30 km altitude, 800 m/s (drag deceleration)
T+460s:  5 km altitude, 300 m/s (ready for landing burn)
```

### Phase 3: Landing Burn (T+460s to T+480s)

**Objective**: Decelerate to soft touchdown, land at target

**Initial Conditions** (at T+460s):
```
Altitude:       5000 m
Velocity:       300 m/s (descending)
Position:       2 km from landing pad (GPS-guided)
```

**Guidance**: PDG algorithm (SCvx optimization)

**Optimization Horizon**: 20-second sliding window
- At T+460s: Solve for trajectory T+460s to T+480s (touchdown)
- At T+461s: Re-solve for trajectory T+461s to T+481s (MPC, Model Predictive Control)
- Update every second until touchdown

**Constraints**:
```python
# Final position: Landing pad
x_final = [0, 0, 0]  # Target coordinates

# Final velocity: Soft touchdown
v_final < 5 m/s  # Vertical velocity
v_lateral < 2 m/s  # Horizontal velocity

# Glide slope constraint: Avoid plume impingement
altitude / horizontal_distance > tan(30°)  # Minimum 30° glide slope angle

# Thrust limits
thrust_min = 0.25 * thrust_max  # Engine throttle range 25-100%
thrust_max = 180 kN

# Attitude limits
||thrust_vector - vertical|| < 5°  # TVC gimbal range ±5°
```

**Solution** (typical trajectory):
```
T+460s:  5000 m, 300 m/s → Full thrust (100%)
T+465s:  3000 m, 180 m/s → Thrust 80%
T+470s:  1500 m, 90 m/s  → Thrust 60%
T+475s:  500 m,  30 m/s  → Thrust 40%
T+478s:  100 m,  10 m/s  → Thrust 30%
T+480s:  0 m,    2.5 m/s → Touchdown (engine cutoff)
```

---

## Successive Convexification (SCvx)

### Algorithm Steps

**Iteration 1: Initial Guess**
```python
# Simple linear trajectory from current state to target
x_ref = linspace(x_initial, x_final, num_points=20)
v_ref = linspace(v_initial, v_final, num_points=20)
thrust_ref = (m * g) * ones(20)  # Hover thrust (initial guess)
```

**Iteration 2-5: Convex Optimization**
```python
for iteration in range(5):
    # Linearize dynamics around reference trajectory
    A, B = linearize_dynamics(x_ref, u_ref)

    # Solve convex optimization problem
    #   Minimize: ∫ ||u|| dt
    #   Subject to: x[k+1] = A[k]*x[k] + B[k]*u[k] (linearized dynamics)
    #               x[N] = x_target (terminal constraint)
    #               u_min ≤ u[k] ≤ u_max (thrust limits)
    #               glide_slope(x[k]) ≥ 0 (safety constraint)

    x_new, u_new = solve_cvxpy(A, B, x_ref, u_ref)

    # Check convergence (trajectory change < threshold)
    if ||x_new - x_ref|| < tolerance:
        break

    # Update reference for next iteration
    x_ref = x_new
    u_ref = u_new
```

**Convergence**: Typically 3-5 iterations, <500 ms computation time

**Output**: Optimal trajectory (position, velocity, thrust vs. time)

### Constraint Handling

**Glide Slope Constraint** (prevent plume-surface interaction):
```python
# Require landing approach angle ≥ 30° from horizontal
altitude / horizontal_distance ≥ tan(30°)

# Equivalent convex constraint:
altitude ≥ 0.577 * horizontal_distance

# In optimization:
for k in range(num_points):
    x[k, 2] ≥ 0.577 * sqrt(x[k, 0]^2 + x[k, 1]^2)
```

**Keep-Out Zones** (avoid obstacles):
```python
# Define circular keep-out zone (e.g., building at [500, 500])
obstacle_center = [500, 500]
obstacle_radius = 100 m

# Constraint: Stay outside obstacle
for k in range(num_points):
    ||x[k, 0:2] - obstacle_center|| ≥ obstacle_radius
```

---

## Implementation Details

### Real-Time Execution

**Triggering**: Landing algorithm activates at T+460s (5 km altitude)

**Execution Frequency**: 1 Hz (re-solve every second)
- Computation time: 300-500 ms (CVXPY solver on [[Flight Computer]])
- Trajectory updated based on latest state estimate from [[Sensor Suite]]

**Model Predictive Control (MPC)**:
```python
while altitude > 10 m:
    # Get current state
    x_current = get_state_estimate()  # From sensor fusion

    # Solve optimization for next 20 seconds
    trajectory = solve_scvx(x_current, x_target, time_horizon=20)

    # Send trajectory to autopilot
    send_trajectory_to_autopilot(trajectory)

    # Sleep 1 second, then re-solve with updated state
    sleep(1)
```

**Final 10 Seconds** (altitude < 10 m):
- Switch to high-rate updates (10 Hz)
- Smaller optimization horizon (5 seconds)
- Tighter constraints (vertical descent only, no lateral translation)

### Solver Configuration

**CVXPY Setup** (convex optimization library):
```python
import cvxpy as cp

# Decision variables
x = cp.Variable((num_points, 6))  # State: [px, py, pz, vx, vy, vz]
u = cp.Variable((num_points, 3))  # Control: [thrust_x, thrust_y, thrust_z]

# Objective: Minimize fuel (minimize total thrust magnitude)
objective = cp.Minimize(cp.sum(cp.norm(u, axis=1)))

# Constraints
constraints = []
for k in range(num_points - 1):
    # Dynamics: x[k+1] = A[k]*x[k] + B[k]*u[k]
    constraints.append(x[k+1] == A[k] @ x[k] + B[k] @ u[k])

# Terminal constraint: End at landing pad
constraints.append(x[-1, 0:3] == [0, 0, 0])  # Position = target
constraints.append(cp.norm(x[-1, 3:6]) <= 5)  # Velocity < 5 m/s

# Thrust limits
for k in range(num_points):
    constraints.append(cp.norm(u[k]) <= thrust_max)
    constraints.append(cp.norm(u[k]) >= thrust_min)

# Solve
problem = cp.Problem(objective, constraints)
problem.solve(solver=cp.ECOS)  # ECOS solver (embedded conic solver, fast)
```

**Solver Performance**:
- Typical solve time: 300 ms (20 timesteps, 6 states, 3 controls)
- Worst-case: 500 ms (convergence requires 5 iterations)
- Success rate: 99% (solver converges in allocated time)

---

## Failure Cases and Abort Logic

### Scenario 1: Optimization Fails to Converge

**Cause**: Infeasible constraints (no solution exists)

**Example**: Wind gust pushes vehicle outside landing pad reachability

**Response**:
```python
if solve_time > 1000 ms or solver_status != OPTIMAL:
    # Optimization failed - use backup trajectory
    trajectory = compute_backup_trajectory(x_current)

    if fuel_remaining < 10%:
        # Insufficient fuel for backup - abort
        abort_sequence()
    else:
        # Execute backup (may land outside target zone)
        send_trajectory_to_autopilot(trajectory)
```

**Backup Trajectory**: Simple proportional navigation (less optimal, but guaranteed feasible)

### Scenario 2: Sensor Failure During Descent

**GPS Loss** (see [[IMU Selection]] for IMU-only performance):
```python
if gps_signal_lost() and altitude < 1000 m:
    # Continue with IMU-only (accept degraded accuracy)
    x_current = get_state_imu_only()

    # Widen landing zone constraint (±100 m instead of ±50 m)
    x_target_relaxed = [0, 0, 0] with tolerance ±100 m

    # Re-solve with relaxed constraints
    trajectory = solve_scvx(x_current, x_target_relaxed)
```

**Expected Landing Accuracy** (GPS-denied): ±100 m (vs. ±12 m with GPS)

### Scenario 3: Engine Throttle Failure

**Stuck at Fixed Throttle** (e.g., throttle valve frozen at 60%):
```python
if throttle_actual != throttle_commanded:
    # Detect throttle failure
    thrust_actual = 0.6 * thrust_max  # Stuck at 60%

    # Re-solve with fixed thrust constraint
    constraints.append(cp.norm(u[k]) == thrust_actual)
    trajectory = solve_scvx(x_current, x_target, fixed_thrust=True)

    if solver_status != OPTIMAL:
        # Cannot land safely with fixed thrust - abort
        abort_sequence()
```

---

## Testing Results

### Monte Carlo Simulation (1000 Runs)

**Nominal Conditions** (no wind, no sensor errors):
```
Success Rate:       100% (1000/1000 landings)
Mean Landing Error: 8.2 m (excellent accuracy)
Fuel Margin:        18% (conservative fuel usage)
```

**Off-Nominal** (10 m/s wind, GPS noise, IMU drift):
```
Success Rate:       96% (960/1000)
Mean Landing Error: 12.4 m (within ±50 m requirement) ✅
Fuel Margin:        12% (still above 10% minimum)

Failures (40/1000):
  - 25: Optimization timeout (solver >1s, aborted)
  - 10: Fuel exhaustion (wind too strong, ran out of fuel)
  - 5: Glide slope violation (trajectory infeasible, aborted)
```

### Hardware-in-the-Loop (HIL) Testing

**50 Simulated Landings** ([[Flight Computer]] running actual code):
```
Success Rate:       94% (47/50)
Computation Time:   380 ms (mean), 520 ms (max) ✅
Landing Accuracy:   14.2 m (mean)

Failures (3/50):
  - 2: Solver timeout (complex wind scenario, 5 iterations not enough)
  - 1: Actuator saturation (TVC gimbal limit exceeded, trajectory infeasible)
```

---

## [[Related Notes]]

**[[Subsystem Integration]]**:
- [[GNC System]] - Parent overview
- [[Autopilot Software]] - Trajectory tracking [[Control]]
- [[Trajectory Optimization]] - Theoretical background on SCvx

**Sensors**:
- [[IMU Selection]] - [[State Estimation]] during descent
- [[Sensor Suite]] - [[GPS]] + [[Sensor Fusion]] for position accuracy

**[[Testing]]**:
- [[Avionics Integration]] - HIL [[Testing Results]]
- [[Test Campaign Overview]] - Simulation statistics

**[[Team]]**:
- [[Elena Rodriguez]] - [[Avionics Lead]] (algorithm [[Design]])
- [[Sarah Chen]] - [[Chief Engineer]] ([[Requirements]] [[Approval]])
