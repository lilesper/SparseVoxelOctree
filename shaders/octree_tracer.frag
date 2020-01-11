#version 450 core
//RAY MARCH METHOD IS COPIED FROM https://code.google.com/archive/p/efficient-sparse-voxel-octrees/
#define STACK_SIZE 23 //must be 23
#define EPS 3.552713678800501e-15

layout(std140, binding = 5) uniform uuCamera {
	int uWidth, uHeight, uBeamSize, uA;
	mat4 uProjection;
	mat4 uView;
	vec4 uPosition;
};
uniform int uViewType, uBeamEnable;

out vec4 oFragColor;

layout(std430, binding = 3) readonly buffer uuOctree { uint uOctree[]; };
layout(binding = 4) uniform sampler2D uBeam;

uint iter = 0;
struct StackItem { uint node; float t_max; } stack[STACK_SIZE];
bool RayMarchLeaf(vec3 o, vec3 d, out float o_t, out vec3 o_color, out vec3 o_normal) {
	d.x = abs(d.x) > EPS ? d.x : (d.x >= 0 ? EPS : -EPS);
	d.y = abs(d.y) > EPS ? d.y : (d.y >= 0 ? EPS : -EPS);
	d.z = abs(d.z) > EPS ? d.z : (d.z >= 0 ? EPS : -EPS);

	// Precompute the coefficients of tx(x), ty(y), and tz(z).
	// The octree is assumed to reside at coordinates [1, 2].
	vec3 t_coef = 1.0f / -abs(d);
	vec3 t_bias = t_coef * o;

	uint oct_mask = 0u;
	if(d.x > 0.0f) oct_mask ^= 1u, t_bias.x = 3.0f * t_coef.x - t_bias.x;
	if(d.y > 0.0f) oct_mask ^= 2u, t_bias.y = 3.0f * t_coef.y - t_bias.y;
	if(d.z > 0.0f) oct_mask ^= 4u, t_bias.z = 3.0f * t_coef.z - t_bias.z;

	// Initialize the active span of t-values.
	float t_min = max(max(2.0f * t_coef.x - t_bias.x, 2.0f * t_coef.y - t_bias.y), 2.0f * t_coef.z - t_bias.z);
	float t_max = min(min(       t_coef.x - t_bias.x,        t_coef.y - t_bias.y),        t_coef.z - t_bias.z);
	t_min = max(t_min, 0.0f);
	float h = t_max;

	uint parent = 0u;
	uint cur    = 0u;
	vec3 pos    = vec3(1.0f);
	uint idx    = 0u;
	if(1.5f * t_coef.x - t_bias.x > t_min) idx ^= 1u, pos.x = 1.5f;
	if(1.5f * t_coef.y - t_bias.y > t_min) idx ^= 2u, pos.y = 1.5f;
	if(1.5f * t_coef.z - t_bias.z > t_min) idx ^= 4u, pos.z = 1.5f;

	uint  scale      = STACK_SIZE - 1;
	float scale_exp2 = 0.5f; //exp2( scale - STACK_SIZE )

	while( scale < STACK_SIZE ) {
		++iter;
		if(cur == 0u) cur = uOctree[ parent + ( idx ^ oct_mask ) ];
		// Determine maximum t-value of the cube by evaluating
		// tx(), ty(), and tz() at its corner.

		vec3 t_corner = pos * t_coef - t_bias;
		float tc_max = min(min(t_corner.x, t_corner.y), t_corner.z);

		if( (cur & 0x80000000u) != 0 && t_min <= t_max ) {
			// INTERSECT
			float tv_max = min(t_max, tc_max);
			float half_scale_exp2 = scale_exp2 * 0.5f;
			vec3 t_center = half_scale_exp2 * t_coef + t_corner;

			if( t_min <= tv_max ) {
				if( (cur & 0x40000000u) != 0 ) // leaf node
					break;

				// PUSH
				if( tc_max < h ) {
					stack[ scale ].node = parent;
					stack[ scale ].t_max = t_max;
				}
				h = tc_max;

				parent = cur & 0x3fffffffu;

				idx = 0u;
				-- scale;
				scale_exp2 = half_scale_exp2;
				if(t_center.x > t_min) idx ^= 1u, pos.x += scale_exp2;
				if(t_center.y > t_min) idx ^= 2u, pos.y += scale_exp2;
				if(t_center.z > t_min) idx ^= 4u, pos.z += scale_exp2;

				cur = 0;
				t_max = tv_max;

				continue;
			}
		}

		//ADVANCE
		uint step_mask = 0u;
		if(t_corner.x <= tc_max) step_mask ^= 1u, pos.x -= scale_exp2;
		if(t_corner.y <= tc_max) step_mask ^= 2u, pos.y -= scale_exp2;
		if(t_corner.z <= tc_max) step_mask ^= 4u, pos.z -= scale_exp2;

		// Update active t-span and flip bits of the child slot index.
		t_min = tc_max;
		idx ^= step_mask;

		// Proceed with pop if the bit flips disagree with the ray direction.
		if( (idx & step_mask) != 0 ) {
			// POP
			// Find the highest differing bit between the two positions.
			uint differing_bits = 0;
			if ((step_mask & 1u) != 0) differing_bits |= floatBitsToUint(pos.x) ^ floatBitsToUint(pos.x + scale_exp2);
			if ((step_mask & 2u) != 0) differing_bits |= floatBitsToUint(pos.y) ^ floatBitsToUint(pos.y + scale_exp2);
			if ((step_mask & 4u) != 0) differing_bits |= floatBitsToUint(pos.z) ^ floatBitsToUint(pos.z + scale_exp2);
			scale = findMSB(differing_bits);
			scale_exp2 = uintBitsToFloat((scale - STACK_SIZE + 127u) << 23u); // exp2f(scale - s_max)

			// Restore parent voxel from the stack.
			parent = stack[scale].node;
			t_max  = stack[scale].t_max;

			// Round cube position and extract child slot index.
			uint shx = floatBitsToUint(pos.x) >> scale;
			uint shy = floatBitsToUint(pos.y) >> scale;
			uint shz = floatBitsToUint(pos.z) >> scale;
			pos.x = uintBitsToFloat(shx << scale);
			pos.y = uintBitsToFloat(shy << scale);
			pos.z = uintBitsToFloat(shz << scale);
			idx  = (shx & 1u) | ((shy & 1u) << 1u) | ((shz & 1u) << 2u);

			// Prevent same parent from being stored again and invalidate cached child descriptor.
			h = 0.0f;
			cur = 0;
		}
	}

	vec3 norm, t_corner = t_coef * (pos + scale_exp2) - t_bias;
	if(t_corner.x > t_corner.y && t_corner.x > t_corner.z)
		norm = vec3(-1, 0, 0);
	else if(t_corner.y > t_corner.z)
		norm = vec3(0, -1, 0);
	else
		norm = vec3(0, 0, -1);
	if ((oct_mask & 1u) == 0u) norm.x = -norm.x;
	if ((oct_mask & 2u) == 0u) norm.y = -norm.y;
	if ((oct_mask & 4u) == 0u) norm.z = -norm.z;

	o_normal = norm;
	o_color = vec3( cur & 0xffu, (cur >> 8u) & 0xffu, (cur >> 16u) & 0xffu) * 0.00392156862745098f; // (...) / 255.0f
	o_t = t_min;

	return scale < STACK_SIZE && t_min <= t_max;
}

vec3 GenRay() {
	vec2 coord = ivec2(gl_FragCoord.xy) / vec2(uWidth, uHeight);
	coord = coord * 2.0f - 1.0f;
	return normalize(mat3(inverse(uView)) * (inverse(uProjection) * vec4(coord, 1, 1) ).xyz);
}

void main() {
	vec3 o = uPosition.xyz, d = GenRay();

	if(uBeamEnable == 1) {
		ivec2 beam_coord = ivec2(gl_FragCoord.xy) / uBeamSize;
		float beam = texelFetch(uBeam, beam_coord, 0).r;
		beam = min(beam, texelFetch(uBeam, beam_coord + ivec2(1, 0), 0).r);
		beam = min(beam, texelFetch(uBeam, beam_coord + ivec2(0, 1), 0).r);
		beam = min(beam, texelFetch(uBeam, beam_coord + ivec2(1, 1), 0).r);
		o += d * beam;
	}

	float t; vec3 color, normal;
	bool hit = RayMarchLeaf(o, d, t, color, normal);
	if(uViewType == 2)
		oFragColor = vec4( vec3(iter / 64.0f), 1 );
	else
		oFragColor = vec4( hit ? ( uViewType == 0 ? color : normal * 0.5f + 0.5f ) : vec3(0), 1 );
}
