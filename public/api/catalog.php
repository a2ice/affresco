<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

// Only published imagery is stored on FTP. The Git repo contains metadata,
// never the source or prepared photos. SKU is the filename without extension.
$root = dirname(__DIR__);
$locations = [
    'original' => [
        ['path' => $root . '/Images/catalog', 'url' => '/Images/catalog/'],
        ['path' => $root . '/Images/каталог', 'url' => '/Images/%D0%BA%D0%B0%D1%82%D0%B0%D0%BB%D0%BE%D0%B3/'],
        ['path' => $root . '/images/catalog', 'url' => '/images/catalog/'],
    ],
    'prepared' => [
        // Owner's FTP layout: prepared files inside the original catalog.
        // Directory names are case-sensitive on Linux/hosting.
        ['path' => $root . '/Images/catalog/Prepared', 'url' => '/Images/catalog/Prepared/'],
        ['path' => $root . '/Images/каталог/Prepared', 'url' => '/Images/%D0%BA%D0%B0%D1%82%D0%B0%D0%BB%D0%BE%D0%B3/Prepared/'],
        ['path' => $root . '/Images/catalog/prepared', 'url' => '/Images/catalog/prepared/'],
        ['path' => $root . '/Images/каталог/prepared', 'url' => '/Images/%D0%BA%D0%B0%D1%82%D0%B0%D0%BB%D0%BE%D0%B3/prepared/'],
        // Legacy flat layout retained for backwards compatibility.
        ['path' => $root . '/Images/prepared', 'url' => '/Images/prepared/'],
        ['path' => $root . '/images/catalog/Prepared', 'url' => '/images/catalog/Prepared/'],
        ['path' => $root . '/images/catalog/prepared', 'url' => '/images/catalog/prepared/'],
        ['path' => $root . '/images/prepared', 'url' => '/images/prepared/'],
    ],
];

/**
 * Read images from directories in priority order. Never infer article numbers,
 * centimeters, or orientation from pixel dimensions or filenames.
 */
function findImages(array $directories): array
{
    $images = [];
    foreach ($directories as $dir) {
        if (!is_dir($dir['path']) || !is_readable($dir['path'])) {
            continue;
        }
        $filenames = scandir($dir['path']);
        if ($filenames === false) {
            continue;
        }
        natcasesort($filenames);
        foreach ($filenames as $filename) {
            $localPath = $dir['path'] . DIRECTORY_SEPARATOR . $filename;
            if (!is_file($localPath) || is_link($localPath)) {
                continue;
            }
            if (!preg_match('/\.(?:jpe?g|png|webp|avif)$/i', $filename)) {
                continue;
            }
            $sku = pathinfo($filename, PATHINFO_FILENAME);
            // Allow article names with Cyrillic letters, Latin letters, digits,
            // dots, underscores and dashes. No path separators or traversal.
            if (!preg_match('/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,99}$/u', $sku)
                || isset($images[$sku])) {
                continue;
            }
            $images[$sku] = $dir['url'] . rawurlencode($filename);
            if (count($images) >= 200) {
                return $images;
            }
        }
    }
    return $images;
}

$original = findImages($locations['original']);
$prepared = findImages($locations['prepared']);

// Human-verified physical dimensions, keyed by exact SKU. The metadata is
// intentionally public, contains no credentials or personal information.
$metadataFile = $root . '/data/catalog.json';
$catalogMeta = [];
if (is_file($metadataFile)) {
    $json = file_get_contents($metadataFile);
    $decoded = $json === false ? null : json_decode($json, true);
    if (!is_array($decoded) || !isset($decoded['items']) || !is_array($decoded['items'])) {
        http_response_code(503);
        echo json_encode(['items' => [], 'status' => 'metadata_invalid']);
        exit;
    }
    $catalogMeta = $decoded['items'];
}

$allSkus = array_unique(array_merge(array_keys($original), array_keys($prepared)));
natcasesort($allSkus);
$items = [];
foreach ($allSkus as $sku) {
    // Array keys for filenames like 1234.jpg become integers in PHP.
    // Always send string article IDs to the browser.
    // Catalog stays usable while the owner gradually uploads prepared photos.
    // As soon as a prepared file with the same SKU appears it takes priority.
    $photo = $prepared[$sku] ?? $original[$sku] ?? null;
    if ($photo === null) {
        continue;
    }
    $meta = $catalogMeta[$sku] ?? [];
    $meta = is_array($meta) ? $meta : [];
    $width = $meta['width_cm'] ?? null;
    $height = $meta['height_cm'] ?? null;
    $width = (is_int($width) || is_float($width)) && is_finite((float)$width) && $width > 0
        ? (float)$width : null;
    $height = (is_int($height) || is_float($height)) && is_finite((float)$height) && $height > 0
        ? (float)$height : null;

    $orientation = $meta['orientation'] ?? null;
    if (!in_array($orientation, ['landscape', 'portrait', 'square'], true)) {
        $orientation = null;
    }

    // Editorial fields are filled from owner-approved per-SKU mapping only.
    $name = $meta['name'] ?? null;
    $name = is_string($name) ? trim($name) : '';
    $name = $name !== '' ? mb_substr($name, 0, 180) : null;
    $description = $meta['description'] ?? null;
    $description = is_string($description) ? trim($description) : '';
    $description = $description !== '' ? mb_substr($description, 0, 500) : null;

    $items[] = [
        'sku' => (string) $sku,
        'name' => $name,
        'description' => $description,
        'image' => $photo,
        'original_image' => $original[$sku] ?? null,
        'prepared' => isset($prepared[$sku]),
        'width_cm' => $width,
        'height_cm' => $height,
        'orientation' => $orientation,
    ];
    if (count($items) >= 200) {
        break;
    }
}
echo json_encode([
    'items' => $items,
    'status' => $items ? 'ok' : 'images_pending',
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
