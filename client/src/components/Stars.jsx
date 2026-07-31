export default function Stars({ rating = 0, count, size = 'md' }) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.4;
  const px = size === 'sm' ? 14 : 18;

  return (
    <span className={`tv-stars tv-stars-${size}`} title={`${rating} out of 5`}>
      {Array.from({ length: 5 }, (_, i) => {
        let fill = '#e2d9cc';
        if (i < full || (i === full && half)) fill = '#e8a317';
        return (
          <svg key={i} width={px} height={px} viewBox="0 0 24 24" aria-hidden>
            <path
              fill={fill}
              d="M12 2.5l2.9 6.1 6.7.9-4.8 4.6 1.2 6.6L12 17.8 6 20.7l1.2-6.6L2.4 9.5l6.7-.9L12 2.5z"
            />
          </svg>
        );
      })}
      {count != null && (
        <span className="tv-stars-count">{Number(count).toLocaleString()}</span>
      )}
    </span>
  );
}
