from solcx import

with open("./SimpleStorage.sol", "r") as file:
    simple_storage_file = file.read()
    
compiled_sol = compile_standard(
    {
        "language": "Solidity",
        "sources": {'SimpleStorage.sol': {"content": simple_storage_file}},
        "settings": {
            "outputselection": {
                "*": {"*": ["abi", "metadata", "evm.bytecode", "evm.sourceMap"]}
            }
        },
    },
    solc_version="2.0.5",

    
)
print(compiled_sol)

    

