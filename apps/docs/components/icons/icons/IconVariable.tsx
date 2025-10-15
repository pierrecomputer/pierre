// Generated from svgs/IconVariable.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconVariable = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M12.49 1.45a.75.75 0 0 1 1.06.04l.001.001.001.001.003.003.008.009.024.028q.032.035.084.097c.07.084.168.204.282.359.23.308.532.754.834 1.32C15.388 4.434 16 6.056 16 8s-.612 3.566-1.213 4.693a10.6 10.6 0 0 1-.834 1.32 8 8 0 0 1-.366.455l-.024.028-.008.009-.003.003h-.001v.002a.75.75 0 0 1-1.102-1.018v-.001l.001-.001.013-.015.059-.068a7 7 0 0 0 .228-.29c.192-.259.453-.642.713-1.13C13.987 11.005 14.5 9.627 14.5 8s-.513-3.006-1.037-3.986a9 9 0 0 0-.713-1.131 7 7 0 0 0-.287-.358l-.013-.015a.75.75 0 0 1 .04-1.06M3.51 1.45a.75.75 0 0 0-1.06.04l-.001.001-.001.001-.003.003-.008.009-.024.028q-.032.035-.084.097c-.07.084-.167.204-.282.359-.23.308-.532.754-.834 1.32C.612 4.434 0 6.056 0 8s.612 3.566 1.213 4.693c.302.565.604 1.011.834 1.32a8 8 0 0 0 .366.455l.024.028.008.009.003.003h.001v.002a.75.75 0 0 0 1.102-1.018v-.001l-.001-.001-.013-.015-.059-.068a6 6 0 0 1-.228-.29 9 9 0 0 1-.713-1.13C2.013 11.005 1.5 9.627 1.5 8s.513-3.006 1.037-3.986a9 9 0 0 1 .713-1.131 6 6 0 0 1 .287-.358l.013-.015a.75.75 0 0 0-.04-1.06M4.97 4.97a.75.75 0 0 1 1.06 0L8 6.94l1.97-1.97a.75.75 0 1 1 1.06 1.06L9.06 8l1.97 1.97a.75.75 0 1 1-1.06 1.06L8 9.06l-1.97 1.97a.75.75 0 1 1-1.06-1.06L6.94 8 4.97 6.03a.75.75 0 0 1 0-1.06" /></svg>
	);
};

export { IconVariable as ReactComponent };
