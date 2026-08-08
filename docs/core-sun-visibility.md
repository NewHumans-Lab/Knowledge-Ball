# Core Sun visibility model

The physical central Sun is intentionally set to radius 18, twice the default ordinary-node radius of 9. The existing additive corona is scaled to 6x the Sun diameter, making the radiation envelope visible at whole-graph scale without changing graph physics. The point light remains distance-attenuated and is strengthened only enough to affect light-reactive node materials.

This first visibility pass uses the existing radial additive corona as the low-cost volumetric/Tyndall approximation. A true ray-marched volumetric pass is intentionally avoided because it would add substantial mobile GPU cost for little benefit at the current scene scale.
