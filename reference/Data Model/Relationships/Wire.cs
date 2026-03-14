using System;

namespace ShapeDiver.GraphDb;

/// <summary>
/// A wire connecting two <see cref="ComponentInstance"> nodes.
/// </summary>
public struct Wire
{
    /// <summary>
    /// Instance guid of the source component's output.
    /// This coincides with the instance guid of source component in case of primitive parameter components.
    /// </summary>
    [DbSerialize]
    public Guid SourceInstanceGuid;

    /// <summary>
    /// Instance guid of the target component's input.
    /// This coincides with the instance guid of target component in case of primitive parameter components.
    /// </summary>
    [DbSerialize]
    public Guid TargetInstanceGuid;

    /// <summary>
    /// In case the source component is a cluster: instance guid of the corresponding cluster output.
    /// </summary>
    [DbSerialize]
    public string ClusterSourceInstanceGuid;

    /// <summary>
    /// In case the target component is a cluster: instance guid of the corresponding cluster input.
    /// </summary>
    [DbSerialize]
    public string ClusterTargetInstanceGuid;


    /// <summary>
    /// Name of the source component's output.
    /// This coincides with the name of source component in case of primitive parameter components.
    /// </summary>
    [DbSerialize]
    public string SourceName;

    /// <summary>
    /// Name of the target component's input.
    /// This coincides with the name of target component in case of primitive parameter components.
    /// </summary>
    [DbSerialize]
    public string TargetName;

}