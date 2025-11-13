import fetch from 'node-fetch';
import logger from '../logger.js';

/**
 * Fetches product information from OpenFoodFacts API
 * @param {string} barcode - The UPC/EAN barcode to lookup
 * @returns {Promise<Object>} Product information or error
 */
export async function fetchProduct(barcode) {
  const startTime = Date.now();
  
  logger.debug('Fetching from OpenFoodFacts', { barcode });
  
  try {
    const url = `https://world.openfoodfacts.org/api/v2/product/${barcode}.json`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'ShoppingListApp/1.0 (Contact: app@shoppinglist.com)',
      },
    });

    if (!response.ok) {
      const duration = Date.now() - startTime;
      logger.warn('OpenFoodFacts API error', {
        barcode,
        status: response.status,
        duration: `${duration}ms`
      });
      
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
      const duration = Date.now() - startTime;
      logger.warn('OpenFoodFacts product not found', {
        barcode,
        duration: `${duration}ms`
      });
      return {
        found: false,
        error: 'Product not found in OpenFoodFacts database',
      };
    }

    const product = data.product;

    // Extract relevant information
    const result = {
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
    
    const duration = Date.now() - startTime;
    logger.info('OpenFoodFacts product found', {
      barcode,
      productName: result.productName,
      brand: result.brand,
      duration: `${duration}ms`
    });
    
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('OpenFoodFacts API error', {
      barcode,
      duration: `${duration}ms`,
      error: error.message
    });
    return {
      found: false,
      error: error.message || 'Failed to fetch product information',
    };
  }
}
