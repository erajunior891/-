import os
import struct
import zlib
import math

def make_png(width, height, get_pixel_rgba):
    """Generate a valid RGBA PNG bytearray from dimensions and pixel callback (x, y) -> (r, g, b, a)."""
    raw_data = bytearray()
    for y in range(height):
        raw_data.append(0)  # Filter type 0 (None)
        for x in range(width):
            r, g, b, a = get_pixel_rgba(x, y)
            raw_data.extend([max(0, min(255, int(r))),
                             max(0, min(255, int(g))),
                             max(0, min(255, int(b))),
                             max(0, min(255, int(a)))])
    
    compressed = zlib.compress(bytes(raw_data), 9)
    
    def chunk(tag, data):
        c = bytearray(struct.pack('>I', len(data)))
        c.extend(tag)
        c.extend(data)
        crc = zlib.crc32(tag + data) & 0xffffffff
        c.extend(struct.pack('>I', crc))
        return c

    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    png = bytearray(b'\x89PNG\r\n\x1a\n')
    png.extend(chunk(b'IHDR', ihdr))
    png.extend(chunk(b'IDAT', compressed))
    png.extend(chunk(b'IEND', b''))
    return bytes(png)

def fill_rect(grid, x0, y0, w, h, rgba):
    for y in range(y0, y0 + h):
        for x in range(x0, x0 + w):
            if 0 <= x < 64 and 0 <= y < 64:
                grid[y][x] = rgba

def noise(x, y, seed=0):
    n = (x * 374761393 + y * 668265263 + seed * 94837289) & 0x7fffffff
    n = (n ^ (n >> 13)) * 1274126177
    return ((n ^ (n >> 16)) & 0xff) / 255.0

def clamp(val, low=0, high=255):
    return max(low, min(high, int(val)))

def lerp_color(c1, c2, t):
    t = max(0.0, min(1.0, t))
    return (
        int(c1[0] + (c2[0] - c1[0]) * t),
        int(c1[1] + (c2[1] - c1[1]) * t),
        int(c1[2] + (c2[2] - c1[2]) * t),
        int(c1[3] + (c2[3] - c1[3]) * t)
    )

def create_skin_grid(theme):
    grid = [[(0, 0, 0, 0) for _ in range(64)] for _ in range(64)]
    skin_tones = [(215, 168, 132, 255), (198, 150, 114, 255), (175, 130, 95, 255)]
    
    if theme == "normal":
        tunic_main = (160, 35, 35, 255)
        tunic_dark = (120, 25, 25, 255)
        armor_main = (165, 135, 95, 255)
        armor_highlight = (210, 175, 120, 255)
        accent = (220, 180, 50, 255)
        eye_color = (60, 120, 180, 255)
        hair_color = (60, 40, 25, 255)
    elif theme == "heavy":
        tunic_main = (110, 20, 20, 255)
        tunic_dark = (70, 15, 15, 255)
        armor_main = (150, 155, 160, 255)
        armor_highlight = (200, 205, 215, 255)
        accent = (80, 85, 95, 255)
        eye_color = (40, 40, 40, 255)
        hair_color = (30, 25, 20, 255)
    elif theme == "fast":
        tunic_main = (45, 110, 140, 255)
        tunic_dark = (30, 75, 100, 255)
        armor_main = (130, 95, 60, 255)
        armor_highlight = (165, 125, 80, 255)
        accent = (210, 195, 150, 255)
        eye_color = (80, 170, 140, 255)
        hair_color = (110, 70, 40, 255)
    elif theme == "archer":
        tunic_main = (55, 90, 45, 255)
        tunic_dark = (35, 60, 30, 255)
        armor_main = (115, 80, 50, 255)
        armor_highlight = (155, 110, 70, 255)
        accent = (180, 140, 90, 255)
        eye_color = (80, 120, 60, 255)
        hair_color = (75, 45, 25, 255)
    elif theme == "champion":
        tunic_main = (115, 25, 125, 255)
        tunic_dark = (75, 15, 85, 255)
        armor_main = (220, 175, 45, 255)
        armor_highlight = (255, 225, 110, 255)
        accent = (245, 200, 70, 255)
        eye_color = (90, 190, 230, 255)
        hair_color = (40, 30, 25, 255)
    else:  # boss
        tunic_main = (150, 15, 25, 255)
        tunic_dark = (90, 5, 15, 255)
        armor_main = (45, 45, 50, 255)
        armor_highlight = (215, 160, 35, 255)
        accent = (235, 40, 40, 255)
        eye_color = (255, 40, 40, 255)
        hair_color = (20, 20, 20, 255)

    for y in range(0, 16):
        for x in range(0, 32):
            ns = noise(x, y, 1)
            sk = skin_tones[int(ns * 2.99)]
            grid[y][x] = sk
            
    fill_rect(grid, 8, 0, 8, 8, hair_color)
    fill_rect(grid, 8, 8, 8, 2, hair_color)
    fill_rect(grid, 0, 8, 8, 8, hair_color)
    fill_rect(grid, 16, 8, 8, 8, hair_color)
    fill_rect(grid, 24, 8, 8, 8, hair_color)
    
    grid[12][10] = eye_color
    grid[12][11] = (240, 240, 240, 255)
    grid[12][14] = (240, 240, 240, 255)
    grid[12][13] = eye_color
    grid[11][10] = hair_color
    grid[11][11] = hair_color
    grid[11][13] = hair_color
    grid[11][14] = hair_color
    grid[14][11] = (160, 110, 80, 255)
    grid[14][12] = (160, 110, 80, 255)
    
    fill_rect(grid, 40, 0, 8, 8, armor_main)
    fill_rect(grid, 40, 8, 8, 4, armor_main)
    fill_rect(grid, 32, 8, 8, 8, armor_main)
    fill_rect(grid, 48, 8, 8, 8, armor_main)
    fill_rect(grid, 56, 8, 8, 8, armor_main)
    
    for y in range(0, 8):
        grid[y][43] = accent
        grid[y][44] = accent
    for y in range(8, 12):
        grid[y][43] = armor_highlight
        grid[y][44] = armor_highlight
        
    for y in range(20, 32):
        for x in range(16, 40):
            ns = noise(x, y, 2)
            c = tunic_main if ns > 0.3 else tunic_dark
            grid[y][x] = c
            
    fill_rect(grid, 21, 21, 6, 8, armor_main)
    grid[22][22] = armor_highlight
    grid[22][25] = armor_highlight
    grid[25][22] = armor_highlight
    grid[25][25] = armor_highlight
    fill_rect(grid, 20, 29, 8, 3, accent)
    fill_rect(grid, 16, 29, 4, 3, accent)
    fill_rect(grid, 28, 29, 4, 3, accent)
    fill_rect(grid, 32, 29, 8, 3, accent)
    
    for y in range(20, 32):
        for x in range(40, 56):
            grid[y][x] = skin_tones[0]
    fill_rect(grid, 40, 20, 16, 4, armor_main)
    fill_rect(grid, 44, 20, 4, 4, armor_highlight)
    fill_rect(grid, 40, 28, 16, 4, armor_main)
    
    for y in range(52, 64):
        for x in range(32, 48):
            grid[y][x] = skin_tones[0]
    fill_rect(grid, 32, 52, 16, 3, tunic_main)
    fill_rect(grid, 32, 60, 16, 4, armor_main)
    
    fill_rect(grid, 0, 20, 16, 4, tunic_dark)
    for y in range(24, 28):
        for x in range(0, 16):
            grid[y][x] = skin_tones[1]
    fill_rect(grid, 0, 28, 16, 4, armor_main)
    fill_rect(grid, 4, 29, 4, 2, armor_highlight)
    
    fill_rect(grid, 16, 52, 16, 4, tunic_dark)
    for y in range(56, 60):
        for x in range(16, 32):
            grid[y][x] = skin_tones[1]
    fill_rect(grid, 16, 60, 16, 4, armor_main)
    fill_rect(grid, 20, 61, 4, 2, armor_highlight)
    
    return grid

def generate_skins(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    themes = ["normal", "heavy", "fast", "archer", "champion", "boss"]
    for theme in themes:
        grid = create_skin_grid(theme)
        def get_pix(x, y):
            return grid[y][x]
        png_data = make_png(64, 64, get_pix)
        path = os.path.join(out_dir, f"gladiator_{theme}.png")
        with open(path, "wb") as f:
            f.write(png_data)
        print(f"Generated skin: {path}")

# ==============================================================================
# ULTRA HD 128x128 WEAPONS & ITEMS GENERATION
# ==============================================================================

def generate_128_items(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    
    # 1. Gladius 128x128: Ultra HD Roman steel short sword
    def gladius_128(x, y):
        # Center line: x + y = 128
        # Distance from center line (perpendicular)
        d = (x + y - 128.0) / 1.41421356
        # Position along the blade (bottom-left to top-right)
        along = (x - y) / 1.41421356
        
        # Blade: along in [-32, 74]
        if -32 <= along <= 74:
            # Tapering tip at along > 54
            max_w = 12.0
            if along > 54:
                max_w = 12.0 * (1.0 - (along - 54) / 20.0)
            
            if abs(d) <= max_w:
                # Outer blade edge outline
                if abs(d) > max_w - 1.2:
                    return (70, 80, 95, 255) if d > 0 else (120, 135, 155, 255)
                
                # Central Fuller (blood groove)
                if abs(d) <= 2.2 and along < 52:
                    # Shading inside fuller
                    if abs(d) <= 1.0:
                        return (90, 100, 115, 255)
                    return (115, 125, 140, 255)
                
                # Top bevel (reflecting sky/light)
                if d < 0:
                    t = abs(d) / max_w
                    # Specular glint near tip
                    if along > 60:
                        return (255, 255, 255, 255)
                    r = int(245 - 35 * t)
                    g = int(250 - 30 * t)
                    b = int(255 - 25 * t)
                    return (r, g, b, 255)
                else: # Bottom bevel (in shadow)
                    t = abs(d) / max_w
                    r = int(195 - 75 * t)
                    g = int(205 - 75 * t)
                    b = int(220 - 75 * t)
                    return (r, g, b, 255)

        # Crossguard: along in [-44, -32]
        if -44 <= along <= -32:
            guard_w = 34.0 * (1.0 - abs((along - (-38)) / 6.0)**2 * 0.4)
            if abs(d) <= guard_w:
                # Curled scrollwork tips
                if abs(d) > guard_w - 2.0:
                    return (130, 85, 25, 255) # Deep bronze outline
                # Bronze gradient
                t = (along - (-44)) / 12.0
                if d < 0:
                    # Gold highlight
                    return (255, 220, 90, 255) if abs(d) < guard_w * 0.6 else (225, 180, 55, 255)
                else:
                    # Bronze shadow
                    return (175, 125, 35, 255) if abs(d) < guard_w * 0.6 else (145, 95, 25, 255)

        # Hilt / Grip: along in [-74, -44]
        if -74 <= along <= -44:
            grip_w = 7.5
            if abs(d) <= grip_w:
                if abs(d) > grip_w - 1.5:
                    return (40, 15, 15, 255) # Dark edge
                # 4 ergonomic finger-grip ridges
                ridge = math.sin((along - (-44)) * 0.6)
                if ridge > 0.4:
                    return (170, 45, 45, 255) if d < 0 else (120, 25, 25, 255)
                elif ridge < -0.4:
                    return (90, 20, 20, 255)
                # Golden wire wrap
                if abs(along % 6.0) < 1.0:
                    return (245, 210, 80, 255)
                return (140, 35, 35, 255)

        # Pommel: along in [-92, -74]
        if -92 <= along <= -74:
            center_pommel = -83.0
            dist_pommel = math.sqrt((along - center_pommel)**2 + d*d)
            if dist_pommel <= 12.0:
                if dist_pommel > 10.5:
                    return (130, 85, 25, 255) # Outer bronze rim
                # Faceted Ruby Gemstone in the center
                if dist_pommel <= 5.5:
                    if dist_pommel <= 2.0 and d < 0:
                        return (255, 200, 210, 255) # Brilliant glint
                    # Facet reflection
                    angle = math.atan2(d, along - center_pommel)
                    facet = int((angle + math.pi) / (math.pi / 4)) % 2
                    if facet == 0:
                        return (245, 40, 65, 255)
                    return (170, 15, 30, 255)
                # Golden pommel dome
                if d < 0:
                    return (255, 225, 100, 255) if dist_pommel < 9.0 else (215, 170, 50, 255)
                return (180, 130, 35, 255)

        return (0, 0, 0, 0)

    with open(os.path.join(out_dir, "gladius.png"), "wb") as f:
        f.write(make_png(128, 128, gladius_128))

    # 2. Scutum Shield 128x128: Ultra HD Roman tower shield
    def shield_128(x, y):
        # Bounding box: x in [24, 104], y in [12, 116] (80 wide x 104 high)
        if 24 <= x <= 104 and 12 <= y <= 116:
            # Rounded corners (radius 8)
            dx_corner = 0
            if x < 32: dx_corner = 32 - x
            elif x > 96: dx_corner = x - 96
            dy_corner = 0
            if y < 20: dy_corner = 20 - y
            elif y > 108: dy_corner = y - 108
            
            if dx_corner > 0 and dy_corner > 0:
                if dx_corner*dx_corner + dy_corner*dy_corner > 64:
                    return (0, 0, 0, 0)

            # Outer Gilded Bronze Rim (5px thick)
            is_rim = (x <= 29 or x >= 99 or y <= 17 or y >= 111)
            if is_rim:
                # Decorative rivets every 10px
                if (x % 10 < 3 and (y <= 17 or y >= 111)) or (y % 10 < 3 and (x <= 29 or x >= 99)):
                    return (255, 245, 180, 255)
                return (240, 195, 60, 255) if (x < 64 and y < 64) else (170, 120, 30, 255)

            # Inner rim shadow
            if x in (30, 98) or y in (18, 110):
                return (100, 15, 20, 255)

            # Center Boss (Umbo) at (64, 64)
            cx, cy = 64.0, 64.0
            dist_c = math.sqrt((x - cx)**2 + (y - cy)**2)
            
            if dist_c <= 22.0:
                # Outer rivet flange of umbo
                if dist_c > 18.0:
                    # Flange rivets
                    angle = math.atan2(y - cy, x - cx)
                    rivet = int((angle + math.pi) / (math.pi / 6)) % 2
                    if rivet == 0 and dist_c > 19.5:
                        return (255, 240, 160, 255)
                    return (190, 140, 35, 255) if x <= 64 else (140, 95, 25, 255)
                
                # Central dome
                if dist_c <= 18.0:
                    # 3D spherical shading with light from top-left
                    nx = (x - (cx - 4.0)) / 18.0
                    ny = (y - (cy - 4.0)) / 18.0
                    spec = 1.0 - min(1.0, math.sqrt(nx*nx + ny*ny))
                    if spec > 0.8:
                        return (255, 255, 210, 255) # Bright specular
                    elif spec > 0.4:
                        return (250, 215, 80, 255)
                    else:
                        return (175, 125, 30, 255)

            # Jupiter's Fulmen (Winged Lightning)
            dx = abs(x - cx)
            dy = abs(y - cy)
            
            # Diagonal lightning bolts
            diff = abs(dx - dy)
            if diff <= 3.5 and 20.0 < dist_c < 54.0:
                # Zig-zag step
                step = int(dist_c / 8.0) % 2
                if diff <= 1.8:
                    return (255, 250, 190, 255)
                return (245, 205, 60, 255)

            # Wing feathers extending horizontally from boss
            if dy <= 9.0 and 20.0 < dx < 44.0:
                feather = int(dx) % 5
                if feather in (0, 1):
                    return (255, 230, 100, 255) if y <= 64 else (220, 175, 50, 255)
                return (185, 135, 35, 255)

            # Cylindrical convex shield lighting gradient
            col_t = (x - 24.0) / 80.0
            # Peak light around x=50, falling off to right
            curve = math.sin(col_t * math.pi)
            r = int(150 + 60 * curve - 40 * col_t)
            g = int(20 + 25 * curve)
            b = int(25 + 20 * curve)
            return (clamp(r), clamp(g), clamp(b), 255)

        return (0, 0, 0, 0)

    with open(os.path.join(out_dir, "shield.png"), "wb") as f:
        f.write(make_png(128, 128, shield_128))

    # 3. War Horn 128x128: Ultra HD Roman Cornu (Crystal-Clear Icon)
    def horn_128(x, y):
        cx, cy = 60.0, 66.0
        dx = x - cx
        dy = y - cy
        dist = math.sqrt(dx*dx + dy*dy)
        angle = math.atan2(dy, dx)

        # 1. Hanging crimson ribbons in the center
        if 52 <= x <= 57 and 64 <= y <= 112:
            if y >= 106:
                return (255, 225, 75, 255) # Gold fringe
            if x in (52, 57):
                return (130, 20, 25, 255) # Outline
            return (215, 35, 45, 255) if x <= 54 else (175, 25, 30, 255)

        if 63 <= x <= 68 and 64 <= y <= 116:
            if y >= 110:
                return (255, 225, 75, 255)
            if x in (63, 68):
                return (130, 20, 25, 255)
            return (205, 30, 40, 255) if x <= 65 else (165, 20, 25, 255)

        # 2. Wooden Handle Brace across diameter
        handle_d = abs(dx - dy + 10.0) / 1.414
        along_handle = (dx + dy) / 1.414
        if handle_d <= 3.5 and -28.0 <= along_handle <= 28.0:
            if handle_d > 2.2:
                return (60, 35, 20, 255)
            if abs(along_handle) > 20.0:
                return (245, 210, 75, 255)
            return (135, 75, 35, 255) if (dx - dy) < -10.0 else (95, 50, 25, 255)

        # 3. Flared Bell Mouth at top-right
        bx, by = 96.0, 26.0
        bdx = (x - bx) * math.cos(-0.5) - (y - by) * math.sin(-0.5)
        bdy = (x - bx) * math.sin(-0.5) + (y - by) * math.cos(-0.5)
        bell_ellipse = (bdx / 16.0)**2 + (bdy / 10.0)**2
        
        if bell_ellipse <= 1.0:
            if bell_ellipse > 0.72:
                return (255, 245, 180, 255) if bdy < 0 else (225, 185, 60, 255)
            if bell_ellipse <= 0.4:
                return (40, 20, 15, 255)
            return (160, 95, 30, 255)

        # Funnel cone leading to bell
        if 72 <= x <= 98 and 20 <= y <= 50:
            cone_t = (x - 72.0) / 24.0
            cone_w = 6.0 + cone_t * 9.0
            cone_cy = 44.0 - cone_t * 18.0
            if abs(y - cone_cy) <= cone_w:
                if abs(y - cone_cy) > cone_w - 1.5:
                    return (130, 85, 25, 255)
                if y < cone_cy:
                    return (255, 235, 120, 255)
                return (205, 155, 40, 255)

        # 4. Circular Brass Tube
        is_in_tube_arc = not (-2.6 < angle < -1.1)
        if is_in_tube_arc and 32.0 <= dist <= 46.0:
            tube_r = abs(dist - 39.0)
            if tube_r > 5.5:
                return (130, 85, 25, 255)
            if dy < 0 or dx > 0:
                if tube_r <= 2.0 and dist > 39.0:
                    return (255, 255, 210, 255)
                elif dist > 39.0:
                    return (255, 225, 90, 255)
                else:
                    return (215, 170, 50, 255)
            else:
                if tube_r <= 2.0:
                    return (215, 165, 45, 255)
                return (165, 115, 30, 255)

        # 5. Mouthpiece at bottom-left
        if 20 <= x <= 34 and 82 <= y <= 98:
            mp_dist = math.sqrt((x - 26)**2 + (y - 90)**2)
            if mp_dist <= 8.0:
                if mp_dist > 6.5:
                    return (120, 80, 25, 255)
                if mp_dist <= 2.5:
                    return (255, 250, 190, 255)
                return (235, 190, 55, 255)

        return (0, 0, 0, 0)

    with open(os.path.join(out_dir, "start_fight.png"), "wb") as f:
        f.write(make_png(128, 128, horn_128))

    # 4. Trophy Cup 128x128: Ultra HD Roman Victor's Chalice
    def trophy_128(x, y):
        cx = 64.0
        dx = abs(x - cx)

        # Cup Bowl: y in [14, 66]
        if 14 <= y <= 66:
            # Bowl outer curve
            bowl_w = 38.0 * (1.0 - ((y - 14) / 52.0)**1.6 * 0.55)
            if dx <= bowl_w:
                # Golden Rim at top
                if y in (14, 15, 16, 17):
                    return (255, 250, 190, 255) if x <= 64 else (225, 185, 55, 255)
                
                # Central Faceted Oval Ruby Gemstone at y in [34, 50], dx <= 10.0
                if 34 <= y <= 50 and dx <= 10.0:
                    dist_gem = math.sqrt((dx / 10.0)**2 + ((y - 42.0) / 8.0)**2)
                    if dist_gem <= 1.0:
                        # Bright diamond-like sparkle glint
                        if dx <= 2.5 and 38 <= y <= 42:
                            return (255, 240, 245, 255)
                        if (dx + y) % 4 < 2:
                            return (245, 35, 60, 255)
                        return (175, 15, 30, 255)
                
                # Golden Laurel Wreath wrapping around the bowl
                if 24 <= y <= 32:
                    leaf = int((x + y) / 4) % 2
                    if leaf == 0:
                        return (255, 235, 120, 255) if x <= 64 else (225, 185, 50, 255)

                # Shading of golden chalice
                t = (x - (64.0 - bowl_w)) / (2.0 * bowl_w)
                if t < 0.35:
                    return (255, 235, 110, 255)
                elif t < 0.7:
                    return (235, 190, 50, 255)
                else:
                    return (165, 115, 25, 255)

        # Handles: left and right sweeping handles: y in [22, 64], 30.0 <= dx <= 52.0
        if 22 <= y <= 64 and 30.0 <= dx <= 52.0:
            handle_cx = 41.0
            dist_h = abs(dx - handle_cx)
            if dist_h <= 5.5:
                if dist_h > 4.0:
                    return (140, 95, 25, 255)
                return (250, 215, 80, 255) if x < 64 else (180, 130, 30, 255)

        # Fluted Stem: y in [66, 92], dx <= 9.0
        if 66 <= y <= 92 and dx <= 9.0:
            if y in (66, 67, 90, 91):
                return (255, 235, 120, 255) # Golden collars
            # Classical pillar fluting
            flute = int(dx) % 3
            if flute == 0:
                return (245, 205, 65, 255) if x <= 64 else (175, 125, 30, 255)
            return (215, 170, 45, 255) if x <= 64 else (145, 95, 20, 255)

        # Tiered Marble & Gold Pedestal: y in [92, 118]
        if 92 <= y <= 118:
            base_w = 9.0 + (y - 92.0) * 1.3
            if dx <= base_w:
                if y in (92, 93, 116, 117):
                    return (255, 235, 130, 255) if x <= 64 else (205, 155, 40, 255)
                # Imperial porphyry dark red marble tier
                if 100 <= y <= 110:
                    return (65, 25, 25, 255) if dx > base_w - 4.0 else (95, 35, 35, 255)
                return (235, 185, 50, 255) if x <= 64 else (165, 115, 25, 255)

        return (0, 0, 0, 0)

    with open(os.path.join(out_dir, "trophy.png"), "wb") as f:
        f.write(make_png(128, 128, trophy_128))

    # 5. Sestertius Coin 128x128: Ultra HD Roman Gold Aureus
    def coin_128(x, y):
        cx, cy = 64.0, 64.0
        dx = x - cx
        dy = y - cy
        dist = math.sqrt(dx*dx + dy*dy)

        if dist > 58.0:
            return (0, 0, 0, 0)

        # Outer Milled Border (Beaded Rim) at dist in [52, 58]
        if 52.0 <= dist <= 58.0:
            angle = math.atan2(dy, dx)
            bead = int((angle + math.pi) / (math.pi / 24.0)) % 2
            if bead == 0:
                return (255, 245, 160, 255) if dx < 0 else (200, 150, 35, 255)
            return (150, 100, 20, 255)

        # Inner rim ridge
        if 47.0 <= dist < 52.0:
            return (215, 165, 40, 255)

        # Laurel Wreath at dist in [32, 45]
        if 32.0 <= dist <= 45.0:
            angle = math.atan2(dy, dx)
            leaf = int((angle + math.pi) / (math.pi / 12.0)) % 2
            if leaf == 0:
                return (255, 235, 120, 255) if dx <= 0 else (220, 170, 45, 255)
            return (175, 125, 25, 255)

        # Center Roman Numeral 'X' & Laurel Crown in relief
        if dist <= 26.0:
            # Roman Numeral X
            if abs(abs(dx) - abs(dy)) <= 3.8 and dist <= 22.0:
                # Serif terminals
                if dist > 18.0:
                    return (255, 245, 170, 255) if dx < 0 else (235, 185, 45, 255)
                # Shaded relief
                if dx < dy:
                    return (255, 245, 170, 255)
                return (195, 145, 35, 255)
            # Center coin field
            if dx < 0 and dy < 0:
                return (245, 205, 65, 255)
            return (195, 145, 35, 255)

        # Coin field
        if dx < 0 and dy < 0:
            return (240, 195, 60, 255)
        elif dx > 0 and dy > 0:
            return (170, 120, 25, 255)
        return (215, 165, 40, 255)

    with open(os.path.join(out_dir, "coin.png"), "wb") as f:
        f.write(make_png(128, 128, coin_128))

    print(f"Generated Ultra HD 128x128 items in {out_dir}")

# ==============================================================================
# ULTRA HD 128x128 SPAWN EGGS
# ==============================================================================

def generate_128_spawn_eggs(out_dir):
    os.makedirs(out_dir, exist_ok=True)

    egg_themes = {
        'normal': {
            'base': (165, 35, 35, 255),
            'base_light': (220, 65, 65, 255),
            'base_dark': (105, 18, 18, 255),
            'crest_gold': (245, 205, 60, 255),
            'crest_type': 'sword'
        },
        'heavy': {
            'base': (75, 85, 95, 255),
            'base_light': (130, 145, 160, 255),
            'base_dark': (40, 45, 52, 255),
            'crest_gold': (210, 35, 35, 255),
            'crest_type': 'visor'
        },
        'fast': {
            'base': (40, 115, 150, 255),
            'base_light': (85, 175, 215, 255),
            'base_dark': (20, 65, 90, 255),
            'crest_gold': (245, 215, 110, 255),
            'crest_type': 'wings'
        },
        'archer': {
            'base': (55, 95, 45, 255),
            'base_light': (95, 145, 75, 255),
            'base_dark': (30, 60, 25, 255),
            'crest_gold': (175, 115, 55, 255),
            'crest_type': 'bow'
        },
        'champion': {
            'base': (115, 25, 125, 255),
            'base_light': (175, 50, 190, 255),
            'base_dark': (65, 12, 75, 255),
            'crest_gold': (255, 220, 55, 255),
            'crest_type': 'crown'
        },
        'boss': {
            'base': (25, 25, 30, 255),
            'base_light': (50, 50, 60, 255),
            'base_dark': (12, 12, 16, 255),
            'crest_gold': (255, 35, 35, 255),
            'crest_type': 'boss'
        }
    }

    for name, th in egg_themes.items():
        def egg_128(x, y):
            cx, cy = 64.0, 68.0
            dx = x - cx
            dy = y - cy
            
            # Parametric egg shape formula:
            # Top is narrower than bottom
            # Normalised y: -1 (top) to +1 (bottom)
            ny = dy / 50.0
            if abs(ny) > 1.0:
                return (0, 0, 0, 0)
            
            # Width factor based on vertical height
            w_factor = 38.0 * math.sqrt(max(0.0, 1.0 - ny*ny)) * (1.0 - 0.22 * ny)
            if abs(dx) > w_factor:
                return (0, 0, 0, 0)

            # Outer shell contour shadow
            if abs(dx) > w_factor - 2.5:
                return th['base_dark']

            # 3D spherical lighting calculation
            lx = (dx + 14.0) / 45.0
            ly = (dy + 16.0) / 50.0
            dist_light = math.sqrt(lx*lx + ly*ly)
            
            # Base shaded color
            if dist_light < 0.4:
                base_col = th['base_light']
            elif dist_light < 0.9:
                base_col = th['base']
            else:
                base_col = th['base_dark']

            # High-res emblem in the center
            c_type = th['crest_type']
            crest_col = th['crest_gold']

            # 1. Gladius Sword Crest
            if c_type == 'sword':
                if abs(dx) <= 3.0 and -25 <= dy <= 25:
                    return (255, 245, 180, 255) if dx <= 0 else crest_col
                if abs(dx) <= 16.0 and -10 <= dy <= -6:
                    return crest_col
                if math.sqrt(dx*dx + (dy - 25)**2) <= 5.0:
                    return crest_col

            # 2. Heavy Visor Crest
            elif c_type == 'visor':
                if abs(dx) <= 24.0 and abs(dy) <= 7.0:
                    return (240, 30, 30, 255)
                if abs(dx) <= 28.0 and abs(dy) <= 12.0:
                    return (180, 195, 210, 255) if abs(dx) % 6 < 2 else (90, 100, 110, 255)

            # 3. Fast Wings Crest
            elif c_type == 'wings':
                if abs(dy - abs(dx) * 0.5) <= 3.5 and abs(dx) <= 26.0:
                    return crest_col
                if abs(dx) <= 4.0 and abs(dy) <= 18.0:
                    return (255, 255, 200, 255)

            # 4. Archer Bow Crest
            elif c_type == 'bow':
                bow_dist = math.sqrt(dx*dx + dy*dy)
                if 16.0 <= bow_dist <= 22.0 and dx < 6.0:
                    return crest_col
                if dx == 4 and abs(dy) <= 18:
                    return (230, 230, 230, 255) # Bowstring

            # 5. Champion Crown Crest
            elif c_type == 'crown':
                if -12 <= dy <= 12 and abs(dx) <= 24.0:
                    # 5-point crown
                    peak = abs(dx % 12.0 - 6.0)
                    if dy > -12 + peak * 2.0:
                        if dy > 8:
                            return (255, 245, 160, 255) if (int(dx) % 6 < 2) else crest_col
                        return crest_col

            # 6. Boss Magma Horns Crest
            elif c_type == 'boss':
                # Horns curving up
                if -35 <= dy <= 0:
                    horn_w = 12.0 + abs(dy) * 0.6
                    if abs(abs(dx) - horn_w) <= 4.0:
                        return (255, 215, 60, 255)
                # Glowing volcanic core
                if math.sqrt(dx*dx + dy*dy) <= 14.0:
                    return (255, 50, 30, 255) if math.sqrt(dx*dx + dy*dy) <= 8.0 else (180, 20, 20, 255)

            # Specular glint on egg shell (top-left)
            if (dx + 16.0)**2 + (dy + 22.0)**2 <= 36.0:
                return (255, 255, 255, 240)

            return base_col

        png_data = make_png(128, 128, egg_128)
        path = os.path.join(out_dir, f"egg_gladiator_{name}.png")
        with open(path, "wb") as f:
            f.write(png_data)
        print(f"Generated 128x128 spawn egg: {path}")

def generate_pack_icon(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    def icon_pix(x, y):
        bg = (125, 20, 25, 255)
        border = (225, 185, 55, 255)
        if x < 4 or x >= 124 or y < 4 or y >= 124:
            return border
        if 40 <= y <= 90 and 20 <= x <= 108:
            if y > 75:
                return (45, 30, 25, 255)
            arch_phase = (x - 20) % 18
            if arch_phase < 4 or y < 50:
                return (45, 30, 25, 255)
        if abs(x - y) < 3 and 25 <= x <= 103:
            return (245, 235, 210, 255)
        if abs(x + y - 128) < 3 and 25 <= x <= 103:
            return (245, 235, 210, 255)
        return bg
        
    png_data = make_png(128, 128, icon_pix)
    with open(path, "wb") as f:
        f.write(png_data)
    print(f"Generated pack icon: {path}")

if __name__ == "__main__":
    rp_entity = os.path.join("Colosseum_RP", "textures", "entity")
    rp_items = os.path.join("Colosseum_RP", "textures", "items")
    generate_skins(rp_entity)
    generate_128_items(rp_items)
    generate_128_spawn_eggs(rp_items)
    generate_pack_icon(os.path.join("Colosseum_RP", "pack_icon.png"))
    generate_pack_icon(os.path.join("Colosseum_BP", "pack_icon.png"))
