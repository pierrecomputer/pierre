// Generated from svgs/IconShieldKeyholeFill.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconShieldKeyholeFill = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path fillRule="evenodd" d="M7.896 15.993a.8.8 0 0 0 .207 0l.09-.014q.076-.014.206-.042c.173-.038.415-.1.704-.194a8.5 8.5 0 0 0 2.154-1.065c1.623-1.113 3.3-3.115 3.669-6.6l.002-.024c.048-.667.072-5.12.072-5.804a.75.75 0 0 0-.75-.75c-1.646 0-3.126-.354-4.2-.712A14 14 0 0 1 8.792.3 9 9 0 0 1 8.38.102a.8.8 0 0 0-.758 0L7.54.144A9 9 0 0 1 7.208.3c-.293.132-.723.31-1.258.488-1.073.358-2.554.712-4.2.712a.75.75 0 0 0-.75.75c0 .683.024 5.137.072 5.804l.002.025c.368 3.484 2.046 5.486 3.669 6.599.8.55 1.577.875 2.154 1.065a7 7 0 0 0 .91.236zm.82-8.125a2 2 0 1 0-1.433 0l-.628 2.51A.5.5 0 0 0 7.14 11h1.72a.5.5 0 0 0 .485-.621z" clipRule="evenodd" /></svg>
	);
};

export { IconShieldKeyholeFill as ReactComponent };
