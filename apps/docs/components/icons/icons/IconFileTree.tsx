// Generated from svgs/IconFileTree.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconFileTree = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path fillRule="evenodd" d="M2.5 0v2c0 .69.56 1.25 1.25 1.25H6V1.5A1.5 1.5 0 0 1 7.5 0h2.494a1.5 1.5 0 0 1 1.029.408l.4.378H13.5a1.5 1.5 0 0 1 1.5 1.5V5.5A1.5 1.5 0 0 1 13.5 7h-6A1.5 1.5 0 0 1 6 5.5v-.75H3.75c-.45 0-.875-.112-1.25-.304V11c0 .69.56 1.25 1.25 1.25H6V10.5A1.5 1.5 0 0 1 7.5 9h2.494a1.5 1.5 0 0 1 1.029.408l.4.378H13.5a1.5 1.5 0 0 1 1.5 1.5V14.5a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 6 14.5v-.75H3.75A2.75 2.75 0 0 1 1 11V0zm5 14.5h6v-3.214h-2.077a1.5 1.5 0 0 1-.921-.316l-.108-.093-.4-.377H7.5zm0-9h6V2.286h-2.077a1.5 1.5 0 0 1-.921-.316l-.108-.093-.4-.377H7.5z" clipRule="evenodd" /></svg>
	);
};

export { IconFileTree as ReactComponent };
