using System;

namespace ShapeDiver.GraphDb;

/// <summary>
/// A Grasshopper component definition.
/// </summary>
public struct ComponentDefinition
{
    /// <summary>
    /// Unique id of the component definition.
    /// https://developer.rhino3d.com/api/grasshopper/html/P_Grasshopper_Kernel_IGH_ObjectProxy_Guid.htm
    /// </summary>
    [DbEqualityCheck]
    public Guid ComponentGuid;

    /// <summary>
    /// Name of the component definition.
    /// </summary>
    [DbSerialize]
    public string Name;

}