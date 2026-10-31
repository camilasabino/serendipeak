import styles from './ExplorePlaceholder.module.css';

export function ExplorePlaceholder() {
	return (
		<button type="button" className={styles.explore} disabled>
			Explore another
			<span aria-hidden="true">→</span>
		</button>
	);
}
