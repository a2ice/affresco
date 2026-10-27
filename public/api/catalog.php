<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

// Photos are uploaded separately to FTP and are intentionally not committed to Git.
// Prefer /Images/catalog/; accept a Cyrillic "каталог" directory if that is what exists.
$directories = [
    ['path' => dirname(__DIR__) . '/Images/catalog', 'url' => '/Images/catalog/'],
    ['path' => dirname(__DIR__) . '/Images/каталог', 'url' => '/Images/%D0%BA%D0%B0%D1%82%D0%B0%D0%BB%D0%BE%D0%B3/'],
    ['path' => dirname(__DIR__) . '/images/catalog', 'url' => '/images/catalog/'],
];
$found = null;
foreach ($directories as $directory) {
    if (is_dir($directory['path']) && is_readable($directory['path'])) {
        $found = $directory;
        break;
    }
}
if ($found === null) {
    http_response_code(200);
    echo json_encode(['items' => [], 'status' => 'images_pending'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
$filenames = scandir($found['path']);
if ($filenames === false) {
    http_response_code(503);
    echo json_encode(['error' => 'catalog_unavailable']);
    exit;
}
$itemsBySku = [];
natcasesort($filenames);
foreach ($filenames as $filename) {
    if (!is_file($found['path'] . DIRECTORY_SEPARATOR . $filename)) {
        continue;
    }
    if (!preg_match('/\.((?:jpe?g)|png|webp|avif)$/i', $filename)) {
        continue;
    }
    $sku = pathinfo($filename, PATHINFO_FILENAME);
    // Article (SKU) remains the canonical identifier; reject unsafe/ambiguous names.
    if (!preg_match('/^[\p{L}\p{N}._-]{1,100}$/u', $sku) || isset($itemsBySku[$sku])) {
        continue;
    }
    $itemsBySku[$sku] = [
        'sku' => $sku,
        'name' => 'Фреска ' . $sku,
        'image' => $found['url'] . rawurlencode($filename),
    ];
    if (count($itemsBySku) >= 200) {
        break;
    }
}
echo json_encode(['items' => array_values($itemsBySku), 'status' => 'ok'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
