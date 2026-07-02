# 3D Plan & Cost Estimator — Simple Explanation

## What I understood you want

After a project's estimate is done, you want a new page at **`/plan`** that:
- Shows the building as a **3D model** you can spin, pan, and zoom (good for client meetings).
- Draws the **electrical wiring** inside it as glowing, color-coded 3D lines running between
  the panels (MDB → SMDB → DB).
- Has a **live cost panel** on the side that adds up total wire length and total wire cost,
  with editable price-per-meter so you can change rates live in front of a client.
- Has **toggle buttons**: show/hide walls, isolate just the wiring, show/hide panels & outlets.

## The one important thing I found

Your pipeline does **not** save real room/wall positions from the drawings. It only saves:
- how many floors and how tall they are,
- which panel sits on which floor,
- each cable's length and gauge (size in mm²).

So I can't rebuild the *exact* floor plan. Instead I will **build a clean 3D "tower"** from
your real data: floors stacked by height, panels placed on their correct floor, and cables
drawn as 3D tubes between them. **The lengths and the cost numbers are 100% real** (taken from
the estimate). The walls are just simple see-through floor slabs for context.

(You already confirmed: build it from real data, route is `/plan?project=<id>`, and show a
demo building when there's no data.)

## What I will do (in simple steps)

1. **Install the 3D library** (Three.js + React Three Fiber) — the standard tool for this.
2. **Add the `/plan` page** that loads a project's estimate and turns it into the 3D tower.
3. **Build the 3D view**: floors, panels, glowing color-coded wires, with rotate/pan/zoom.
4. **Build the cost panel**: total wire length, cost by gauge (Heavy / Sub-main / Outlet),
   grand total, and live-editable price boxes.
5. **Add the toggles**: show/hide walls, isolate wiring, show/hide panels & outlets.
6. **Add a "View 3D Plan" button** on the bid page (shows once the estimate/BOQ is ready) and
   a "3D Plan" link in the sidebar.
7. **Show a demo building** when `/plan` is opened with no project, so it's always presentable.
8. **Run a build check** to make sure there are zero errors before finishing.

## What I will NOT do

- No changes to your database or estimate logic — I only *read* the data you already have.
- No fake architecture — the 3D is a clear schematic, and the cost numbers stay honest.

## How you'll check it works

- Open `/plan` → demo building spins, cost panel works, price edits update the total live.
- Open `/plan?project=<a finished project>` → its real floors, panels, and wires show up.
- From a finished bid page → click **View 3D Plan** → lands on this page for that project.
