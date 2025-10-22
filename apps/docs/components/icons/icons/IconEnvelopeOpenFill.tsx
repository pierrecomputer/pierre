// Generated from svgs/IconEnvelopeOpenFill.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconEnvelopeOpenFill = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M4.5.5a2 2 0 0 0-2 2v5.412L8 10.19l5.5-2.278V2.5a2 2 0 0 0-2-2z"/><path d="m14.5 8.622-4.783 1.98L14 13l-6-1.64L2 13l4.283-2.399L1.5 8.622V3.48l-.078.043A2.75 2.75 0 0 0 0 5.93v7.319A2.75 2.75 0 0 0 2.75 16h10.5A2.75 2.75 0 0 0 16 13.25V5.93a2.75 2.75 0 0 0-1.421-2.407L14.5 3.48z"/></svg>
	);
};

export { IconEnvelopeOpenFill as ReactComponent };