// Generated from svgs/IconPencil.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconPencil = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M10.409 1.53a2.25 2.25 0 0 1 3.182 0l.879.879a2.25 2.25 0 0 1 0 3.182l-7.94 7.94a.75.75 0 0 1-.348.197l-4 1a.75.75 0 0 1-.91-.91l1-4a.75.75 0 0 1 .198-.348zm2.121 1.061a.75.75 0 0 0-1.06 0L11.06 3 13 4.94l.409-.41a.75.75 0 0 0 0-1.06zM11.94 6 10 4.06l-6.323 6.323-.646 2.586 2.586-.646z" /></svg>
	);
};

export { IconPencil as ReactComponent };
