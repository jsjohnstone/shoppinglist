import fetch from 'node-fetch';

/**
 * Fetches product information from OpenFoodFacts API
 * @param {string} barcode - The UPC/EAN barcode to lookup
 * @returns {Promise<Object>} Product information or error
 */
export async function fetchProduct(barcode) {
  try {
    const url = `https://world.openfoodfacts.org/api/v2/product/${barcode}.json`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'ShoppingListApp/1.0 (Contact: app@shoppinglist.com)',
      },
    });

    if (!response.ok) {
      console.error(`OpenFoodFacts API error: ${response.status}`);
      
      // 404 means product not found in database
      if (response.status === 404) {
        return {
          found: false,
          error: 'Product not found in OpenFoodFacts database',
        };
      }
      
      // Other errors are actual API failures
      return {
        found: false,
        error: `API request failed with status ${response.status}`,
      };
    }

    const data = await response.json();

    // Check if product was found
    if (data.status === 0 || !data.product) {
      return {
        found: false,
        error: 'Product not found in OpenFoodFacts database',
      };
    }

    const product = data.product;

    // Extract relevant information
    return {
      found: true,
      productName: product.product_name || product.product_name_en || 'Unknown Product',
      brand: product.brands || '',
      categories: product.categories || '',
      genericName: product.generic_name || product.product_name || 'Unknown Product',
      quantity: product.quantity || '',
      // Store the full product name for future reference
      fullProductName: [
        product.brands,
        product.product_name || product.product_name_en,
        product.quantity
      ].filter(Boolean).join(' '),
    };
  } catch (error) {
    console.error('Error fetching from OpenFoodFacts:', error);
    return {
      found: false,
      error: error.message || 'Failed to fetch product information',
    };
  }
}
