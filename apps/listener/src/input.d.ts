declare module "input" {
  const input: {
    text(prompt: string, options?: { hideEchoBack?: boolean }): Promise<string>;
  };

  export default input;
}
