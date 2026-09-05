# PW1100G-JM Engineering Lab — acceptance contract

The authorized objective is a browser-based PW1100G-JM cutaway whose structure,
gear motion and energy accounting are mechanically/physically consistent, with
source and a working public GitHub Pages deployment. The primary Astra agent
owns orchestration, integration and review; implementation workers use the
configured Luna max role. No proprietary fidelity is implied by numerical closure.

## Required milestones

- [x] M1: Source-backed architecture and explicit illustrative parameters.
- [x] M2: Involute double-helical star reducer, five fixed-centre stars, fixed
      carrier, sun input / ring-fan output, exact phase and speed constraints.
- [x] M3: 81-inch fan; 3 LPC, 8 HPC, annular combustor, 2 HPT, 3 LPT; coaxial
      shafts, rotor discs, stationary vanes, bearings and casing load paths.
- [x] M4: Compressible 1D cycle, independent HP/LP rotational dynamics,
      reflected fan/gear inertia, mass/fuel/shaft power/energy accounting,
      documented operating envelope and approximation limits.
- [x] M5: Interactive 3D engine and reducer views, cut modes and caps, transparent
      casing, selection, camera control, pause/slow motion/frame stepping, flow and
      station/shaft diagnostics driven by the same simulation state.
- [x] M6: Independent numerical, geometry, rendered-transform and browser QA,
      published reproducible verification report including measured performance.
- [x] M7: Public GitHub repository, automated checks and GitHub Pages deployment,
      exact published commit inspected and live site verified.

## Model conventions / shared implementation contract

- SI internally; engine axis +X from fan toward exhaust. Radial coordinates Y,Z.
- Positive rotation follows the right hand rule about +X. LP/sun positive;
  fan/ring negative. HP independent; its absolute sense is an illustrative
  convention until a type-specific primary source establishes it.
- Length about 3.41 m; fan tip diameter 2.0574 m; casing outer diameter about
  2.224 m. The simplified nacelle/bypass nozzle is a visualization envelope.
- Illustrative rigid-contact reducer: Zs=30, Zp=30, Zr=90, 5 equally spaced
  stars, transverse module 0.0045 m, transverse pressure angle 20 deg,
  total face width 0.060 m, 20 deg helix, 0.006 m centre relief,
  zero backlash for the ideal rigid-contact constraint. This is not a
  manufacturing tolerance. Exact factory tooth counts and fine geometry are
  NOT verified. Ratio exactly 3 in this model,
  consistent with published approximate 3:1 only.
- Gear centre distances and assembly condition: Zr=Zs+2Zp and
  (Zs+Zr)/5 integer. Contact testing checks conjugate normal velocity;
  involute flank sliding away from the pitch point is physically expected.
- All independent angular integration happens in the physics state. Fan and
  stars derive from LP angle; mesh-level calibration is an initial phase only.
- A viewing time scale applies to the whole simulated time, preserving ratios.
  Pausing freezes simulation, not a modeled engine shutdown. Start in a
  converged running condition; cold start/FADEC/surge/CFD/FEM are outside scope.
- Report normalized kinematic residual <=1e-9, steady mass/power closure <=1e-3;
  test transient energy conservation and step-size convergence independently.
- Tests must inspect constructed mesh transforms and sampled gear profiles,
  not just assert their own implementation's return value.

## Evidence

1. P&W PW1100G-JM product card (2024): fan 81 in, stage arrangement 1-G-3-8-2-3,
   nominal bypass ratio around 12.
   https://prd-sc102-cdn.rtx.com/prattwhitney/-/media/pw/newsroom/collateral/documents/commercial-engines/pw_gtf_pc_pw1100g-jm.pdf
2. IHI Technical Report vol.53 no.4 (2013), pp.28–33: fan case/SGV, front centre
   body and bearing support, LPC IBR and variable inlet guide vanes, LP shaft.
   https://www.ihi.co.jp/technology/techinfo/contents_no/__icsFiles/afieldfile/2023/06/16/dfa646fceb7705a3c159683b20eb8b2b.pdf
3. ASME Global Gas Turbine News Dec/Jan 2022, Lee Langston, printed pp.62–63:
   fixed carrier, five star gears, journal bearings, double-helical teeth,
   ring-fan output and approximate 3:1 first-generation GTF reduction.
   https://www.asme.org/getmedia/1838965b-aa81-41ff-ad77-c06c31984cbd/1221mem-web.pdf
4. EASA.IM.E.093 TCDS: spool configuration, dimensions and certified limits.
   https://www.easa.europa.eu/en/document-library/type-certificates/engine-cs-e/easaime093-pw1100g-jm-series-engines
5. NASA Glenn conservation of energy / compressor / turbine thermodynamics:
   https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/conservation-of-energy/
   https://www.grc.nasa.gov/www/k-12/airplane/compth.html
   https://www.grc.nasa.gov/WWW/K-12/airplane/powtrbth.html

## Ownership

Workers author disjoint physics, gear and engine-geometry modules. They do not
publish, change build configuration or spawn agents. Astra reviews their source,
owns the interface/scene integration, independent acceptance testing, Git and
GitHub publication. Intermediates go in work/, human deliverables in outputs/;
durable source and verification documentation are committed in the repository.
