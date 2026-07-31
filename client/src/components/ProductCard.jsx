import { Link } from 'react-router-dom';
import Stars from './Stars';

export default function ProductCard({ product }) {
  const [dollars, cents] = product.price.amount.split('.');

  return (
    <Link to={`/product/${product.id}`} className="tv-card">
      <div className="tv-card-media">
        <div className="tv-pills">
          {product.isAmazonChoice && <span className="tv-pill pick">Trove Pick</span>}
          {product.isBestseller && <span className="tv-pill hot">Hot</span>}
          {product.isPrime && <span className="tv-pill fast">Fast ship</span>}
        </div>
        <img src={product.images[0]} alt={product.title} loading="lazy" />
      </div>
      <div className="tv-card-body">
        <div className="tv-card-brand">{product.brand}</div>
        <h3 className="tv-card-title">{product.title}</h3>
        <Stars rating={product.ratingAvg} count={product.ratingCount} size="sm" />
        <div className="tv-price-row">
          <span className="tv-price">
            ${dollars}
            <span className="cents">{cents}</span>
          </span>
          {product.listPrice && (
            <span className="tv-list">{product.listPrice.formatted}</span>
          )}
        </div>
        {product.discountPercent > 0 && (
          <div className="tv-save">Save {product.discountPercent}%</div>
        )}
      </div>
    </Link>
  );
}
