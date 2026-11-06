import styles from './EditorNotice.module.css';

interface EditorNoticeProps {
	title: string;
	message: string;
	/** A loading notice is announced politely; a refusal is an alert. */
	busy?: boolean;
}

export function EditorNotice({ title, message, busy = false }: EditorNoticeProps) {
	return (
		<main className={styles.notice}>
			<section className={styles.content} aria-labelledby="editor-notice-title">
				<h1 id="editor-notice-title" className={styles.title}>
					{title}
				</h1>
				<p role={busy ? 'status' : 'alert'} className={styles.message}>
					{message}
				</p>
			</section>
		</main>
	);
}
